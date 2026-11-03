import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cloudflareHeaders = readFileSync(
  new URL("../../public/_headers", import.meta.url),
  "utf8",
);

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
) as {
  headers: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
};

describe("Vercel security headers", () => {
  const headers = config.headers.find((entry) => entry.source === "/(.*)")?.headers;
  const value = (name: string) =>
    headers?.find((header) => header.key.toLowerCase() === name.toLowerCase())?.value;

  it("sets the required transport, browser, and feature policy headers", () => {
    expect(value("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value("Permissions-Policy")).toBe(
      "camera=(self), microphone=(), geolocation=()",
    );
  });

  it("restricts scripts to this origin and allows the required Supabase channels", () => {
    const policy = value("Content-Security-Policy");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("https://iwijqcqmqrzegbtpnjpe.supabase.co");
    expect(policy).toContain("wss://iwijqcqmqrzegbtpnjpe.supabase.co");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});

describe("Cloudflare Pages security headers", () => {
  it("sets the required transport, browser, and feature policy headers", () => {
    expect(cloudflareHeaders).toContain(
      "Strict-Transport-Security: max-age=31536000",
    );
    expect(cloudflareHeaders).toContain("X-Content-Type-Options: nosniff");
    expect(cloudflareHeaders).toContain("X-Frame-Options: DENY");
    expect(cloudflareHeaders).toContain(
      "Referrer-Policy: strict-origin-when-cross-origin",
    );
    expect(cloudflareHeaders).toContain(
      "Permissions-Policy: camera=(self), microphone=(), geolocation=()",
    );
  });

  it("restricts scripts and permits only the required Supabase channels", () => {
    const policy = cloudflareHeaders
      .split(/\r?\n/)
      .find((line) => line.startsWith("  Content-Security-Policy:"))
      ?.replace("  Content-Security-Policy: ", "");

    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("https://iwijqcqmqrzegbtpnjpe.supabase.co");
    expect(policy).toContain("wss://iwijqcqmqrzegbtpnjpe.supabase.co");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("routes client-side paths to the app entry point", () => {
    const redirects = readFileSync(
      new URL("../../public/_redirects", import.meta.url),
      "utf8",
    );
    expect(redirects.trim()).toBe("/* /index.html 200");
  });
});
