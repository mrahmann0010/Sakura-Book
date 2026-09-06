import { describe, expect, it } from "vitest";
import { toE164Bd } from "../../src/sms/phone";

describe("toE164Bd", () => {
  it("prefixes the country code on the local form the waitlist stores", () => {
    expect(toE164Bd("01522112743")).toBe("+8801522112743");
    expect(toE164Bd("01960606284")).toBe("+8801960606284");
    expect(toE164Bd(" 01711111111 ")).toBe("+8801711111111");
  });

  it("accepts the other shapes one number is stored in", () => {
    expect(toE164Bd("01711-111111")).toBe("+8801711111111");
    expect(toE164Bd("01711 111111")).toBe("+8801711111111");
    expect(toE164Bd("+880 1711-111111")).toBe("+8801711111111");
    expect(toE164Bd("8801711111111")).toBe("+8801711111111");
    expect(toE164Bd("008801711111111")).toBe("+8801711111111");
    expect(toE164Bd("1711111111")).toBe("+8801711111111");
    expect(toE164Bd("০১৭১১১১১১১১")).toBe("+8801711111111");
  });

  it("covers every live operator prefix", () => {
    for (const prefix of ["013", "014", "015", "016", "017", "018", "019"]) {
      expect(toE164Bd(`${prefix}11111111`)).toBe(`+880${prefix.slice(1)}11111111`);
    }
  });

  it("hands anything that is not a Bangladeshi mobile to the gateway as typed", () => {
    expect(toE164Bd("01211111111")).toBe("01211111111"); // no 012 operator
    expect(toE164Bd("0171111111")).toBe("0171111111"); // a digit short
    expect(toE164Bd("017111111111")).toBe("017111111111"); // a digit long
    expect(toE164Bd("+14155550123")).toBe("+14155550123");
    expect(toE164Bd(" 12345 ")).toBe("12345");
    expect(toE164Bd("")).toBe("");
  });
});
