import { isIPv4, isIPv6 } from "node:net";

/**
 * SSRF 防护：判定目标是否指向本机 / 内网。
 *
 * `web_fetch` 运行在主进程，具备访问内网的能力，因此：
 * - 请求前先判初始 host
 * - 每一跳 redirect 都要再判一次（防「公网跳内网」）
 *
 * 判定不依赖 DNS：只对字面量 IP 与已知保留域名生效。域名解析到内网
 * 的情况交给运行环境的网络策略，这里不做 DNS 预解析（会引入 TOCTOU）。
 */

const PRIVATE_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

const PRIVATE_SUFFIXES = [".local", ".internal", ".localhost", ".lan"];

/** IPv4 字面量 → 32 位整数；非法返回 null。 */
function ipv4ToInt(ip: string): number | null {
  if (!isIPv4(ip)) return null;
  const parts = ip.split(".");
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inIpv4Range(value: number, base: string, bits: number): boolean {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

/** 保留 / 特殊用途 IPv4 地址段。 */
const IPV4_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // 本机
  ["10.0.0.0", 8], // 私有
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // 回环
  ["169.254.0.0", 16], // 链路本地（含云元数据 169.254.169.254）
  ["172.16.0.0", 12], // 私有
  ["192.0.0.0", 24], // IETF 协议分配
  ["192.168.0.0", 16], // 私有
  ["198.18.0.0", 15], // 基准测试
  ["224.0.0.0", 4], // 组播
  ["240.0.0.0", 4], // 保留
];

function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return IPV4_BLOCKED_RANGES.some(([base, bits]) =>
    inIpv4Range(value, base, bits),
  );
}

/** 展开 IPv6 为 8 组 16 位整数；非法返回 null。 */
function expandIpv6(ip: string): number[] | null {
  let clean = ip.trim().toLowerCase();
  const zone = clean.indexOf("%");
  if (zone !== -1) clean = clean.slice(0, zone);
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1);
  }
  if (!isIPv6(clean)) return null;

  // 末尾内嵌 IPv4（::ffff:127.0.0.1）转成两组十六进制
  const lastColon = clean.lastIndexOf(":");
  const tail = clean.slice(lastColon + 1);
  if (tail.includes(".")) {
    const mapped = ipv4ToInt(tail);
    if (mapped === null) return null;
    const high = ((mapped >>> 16) & 0xffff).toString(16);
    const low = (mapped & 0xffff).toString(16);
    clean = `${clean.slice(0, lastColon)}:${high}:${low}`;
  }

  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (segment: string): number[] | null => {
    if (!segment) return [];
    const out: number[] = [];
    for (const part of segment.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  const left = parseGroups(halves[0] ?? "");
  if (left === null) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;

  const right = parseGroups(halves[1] ?? "");
  if (right === null) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

function isPrivateIpv6(groups: number[]): boolean {
  const head = groups[0]!;
  const byte0 = head >> 8;
  const byte1 = head & 0xff;

  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return true; // ::1
  }
  // IPv4 映射地址按 IPv4 规则判
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mapped = ((groups[6]! << 16) | groups[7]!) >>> 0;
    const dotted = [
      (mapped >>> 24) & 0xff,
      (mapped >>> 16) & 0xff,
      (mapped >>> 8) & 0xff,
      mapped & 0xff,
    ].join(".");
    return isPrivateIpv4(dotted);
  }
  if ((byte0 & 0xfe) === 0xfc) return true; // fc00::/7 唯一本地
  if (byte0 === 0xfe && (byte1 & 0xc0) === 0x80) return true; // fe80::/10 链路本地
  if (byte0 === 0xff) return true; // ff00::/8 组播
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIpv4(ip);
  const groups = expandIpv6(ip);
  return groups ? isPrivateIpv6(groups) : false;
}

/** hostname 是否为本机 / 内网（不做 DNS）。 */
export function isPrivateHostname(hostname: string): boolean {
  let clean = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (clean.startsWith("[") && clean.endsWith("]")) {
    clean = clean.slice(1, -1);
  }
  if (!clean) return false;
  if (PRIVATE_HOSTNAMES.has(clean)) return true;
  if (isPrivateIp(clean)) return true;
  return PRIVATE_SUFFIXES.some((suffix) => clean.endsWith(suffix));
}

/** URL 是否指向本机 / 内网。解析失败返回 false（由调用方另行校验合法性）。 */
export function isPrivateUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (!parsed.hostname) return false;
    return isPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
}
