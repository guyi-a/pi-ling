import { describe, expect, it } from "vitest";

import { isPrivateHostname, isPrivateIp, isPrivateUrl } from "../src/ssrf.js";

describe("isPrivateIp", () => {
  it("blocks IPv4 private and special-purpose ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.5",
      "172.16.3.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("blocks IPv6 loopback, unique-local, link-local and multicast", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("decodes IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:192.168.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });

  it("returns false for non-IP input", () => {
    expect(isPrivateIp("example.com")).toBe(false);
  });
});

describe("isPrivateHostname", () => {
  it("blocks localhost and reserved suffixes", () => {
    for (const host of [
      "localhost",
      "LOCALHOST",
      "localhost.",
      "app.local",
      "db.internal",
      "box.lan",
    ]) {
      expect(isPrivateHostname(host), host).toBe(true);
    }
  });

  it("unwraps bracketed IPv6 hosts", () => {
    expect(isPrivateHostname("[::1]")).toBe(true);
    expect(isPrivateHostname("[2606:4700::1]")).toBe(false);
  });

  it("allows public hostnames", () => {
    expect(isPrivateHostname("docs.anthropic.com")).toBe(false);
    expect(isPrivateHostname("localhost.example.com")).toBe(false);
  });
});

describe("isPrivateUrl", () => {
  it("detects private targets including ports and paths", () => {
    expect(isPrivateUrl("http://localhost:8080/health")).toBe(true);
    expect(isPrivateUrl("https://127.0.0.1/admin")).toBe(true);
    expect(isPrivateUrl("http://169.254.169.254/latest/meta-data")).toBe(true);
    expect(isPrivateUrl("https://api.internal/v1")).toBe(true);
  });

  it("allows public URLs", () => {
    expect(isPrivateUrl("https://example.com/docs")).toBe(false);
    expect(isPrivateUrl("https://raw.githubusercontent.com/a/b/main/c.md")).toBe(
      false,
    );
  });

  it("returns false for unparseable input", () => {
    expect(isPrivateUrl("not a url")).toBe(false);
    expect(isPrivateUrl("")).toBe(false);
  });
});
