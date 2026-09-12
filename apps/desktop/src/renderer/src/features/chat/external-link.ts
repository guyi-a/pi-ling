/**
 * 聊天里的链接一律交给系统浏览器打开，应用内不做页面跳转。
 *
 * 只放行 http/https：`javascript:`、`file:`、`mailto:` 之类一律忽略。
 * 主进程会再校验一次（渲染层输入不可信），这里是第一道闸。
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function isExternalLinkHref(href: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(href.trim()).protocol);
  } catch {
    return false;
  }
}

/** 从点击目标里取出可打开的链接；不是链接或协议不允许时返回 null。 */
export function externalHrefFromClickTarget(
  target: EventTarget | null,
): string | null {
  // 单测跑在无 DOM 环境；浏览器里恒有 Element
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return null;
  }
  const href = target.closest("a")?.getAttribute("href")?.trim();
  if (!href || !isExternalLinkHref(href)) return null;
  return href;
}
