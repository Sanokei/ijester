import { describe, expect, test } from "bun:test";
import { signSessionToken, verifySessionToken } from "../worker/session-token";

const SECRET = "test-secret-value";
const SESSION = "a".repeat(64);

describe("session token", () => {
  test("round-trips", async () => {
    const { token } = await signSessionToken(SECRET, SESSION, 60);
    expect(await verifySessionToken(SECRET, token, SESSION)).toBe(true);
  });

  test("rejects the wrong session id", async () => {
    const { token } = await signSessionToken(SECRET, SESSION, 60);
    expect(await verifySessionToken(SECRET, token, "b".repeat(64))).toBe(false);
  });

  test("rejects the wrong secret", async () => {
    const { token } = await signSessionToken(SECRET, SESSION, 60);
    expect(await verifySessionToken("other-secret", token, SESSION)).toBe(false);
  });

  test("rejects a tampered signature", async () => {
    const { token } = await signSessionToken(SECRET, SESSION, 60);
    const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect(await verifySessionToken(SECRET, tampered, SESSION)).toBe(false);
  });

  test("rejects a tampered expiry", async () => {
    const { token } = await signSessionToken(SECRET, SESSION, 60);
    const [id, exp, sig] = token.split(".") as [string, string, string];
    const forged = `${id}.${Number(exp) + 9_999_999}.${sig}`;
    expect(await verifySessionToken(SECRET, forged, SESSION)).toBe(false);
  });

  test("rejects an expired token", async () => {
    const { token } = await signSessionToken(SECRET, SESSION, -1);
    expect(await verifySessionToken(SECRET, token, SESSION)).toBe(false);
  });

  test("rejects garbage", async () => {
    expect(await verifySessionToken(SECRET, "", SESSION)).toBe(false);
    expect(await verifySessionToken(SECRET, "a.b", SESSION)).toBe(false);
    expect(await verifySessionToken(SECRET, "a.b.c.d", SESSION)).toBe(false);
  });
});
