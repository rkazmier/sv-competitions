import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DUTY_LINK_KEY,
  dutyDecision,
  dutyFromResponse,
  parseDutyMemory,
  readStoredSession,
  serializeDutyMemory,
  showDutyLink,
} from "./duty-link";
import { forgetDuty, rememberDuty } from "./duty-link-ui";

const b64 = (value: object) =>
  btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const jwt = (claims: object) => `h.${b64(claims)}.s`;
// 2026-11-20 12:00 w Warszawie (UTC+1)
const NOW = new Date("2026-11-20T11:00:00Z");
const FUTURE = Math.floor(NOW.getTime() / 1000) + 3600;
const session = (claims: object, expiresAt: number | undefined = FUTURE) =>
  JSON.stringify({
    access_token: jwt({ sub: "u1", exp: FUTURE, ...claims }),
    expires_at: expiresAt,
  });
const memory = (value: object) => JSON.stringify(value);

describe("link „Książka” w nagłówku (SPEC-009)", () => {
  it("odczyt sub, tokenu i ważności z zapisanej sesji", () => {
    expect(readStoredSession(session({ app_role: "user" }))).toEqual({
      sub: "u1",
      accessToken: jwt({ sub: "u1", exp: FUTURE, app_role: "user" }),
      expiresAt: FUTURE,
    });
    expect(
      readStoredSession(
        JSON.stringify({ access_token: jwt({ sub: "u2", exp: 5 }) }),
      )?.expiresAt,
    ).toBe(5);
    expect(readStoredSession(null)).toBeNull();
    expect(readStoredSession("nie-json")).toBeNull();
    expect(
      readStoredSession(JSON.stringify({ access_token: "bez-kropek" })),
    ).toBeNull();
    expect(
      readStoredSession(
        JSON.stringify({ access_token: jwt({ app_role: "user" }) }),
      ),
    ).toBeNull();
  });

  it("AC-1, AC-8: rola user z ważną sesją i bez pamięci — pytamy bazę", () => {
    expect(dutyDecision(session({ app_role: "user" }), null, NOW)).toEqual({
      kind: "ask",
      sub: "u1",
      accessToken: jwt({ sub: "u1", exp: FUTURE, app_role: "user" }),
    });
  });

  it("AC-3: gość, nieczytelna sesja, sesja bez sub — bez zapytania", () => {
    expect(dutyDecision(null, null, NOW)).toEqual({ kind: "none" });
    expect(dutyDecision("nie-json", null, NOW)).toEqual({ kind: "none" });
    expect(
      dutyDecision(
        JSON.stringify({ access_token: jwt({ app_role: "user" }) }),
        null,
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });

  it("AC-4: staff i admin — bez zapytania, nawet z pamięcią true", () => {
    const remembered = memory({ sub: "u1", day: "2026-11-20", duty: true });
    expect(
      dutyDecision(session({ app_role: "staff" }), remembered, NOW),
    ).toEqual({ kind: "none" });
    expect(
      dutyDecision(session({ app_role: "admin" }), remembered, NOW),
    ).toEqual({ kind: "none" });
    expect(showDutyLink(session({ app_role: "staff" }), true)).toBe(false);
  });

  it("§7: wygasły token — bez zapytania i bez linku", () => {
    const past = Math.floor(NOW.getTime() / 1000) - 1;
    expect(
      dutyDecision(session({ app_role: "user" }, past), null, NOW),
    ).toEqual({ kind: "none" });
    expect(
      dutyDecision(
        JSON.stringify({ access_token: jwt({ sub: "u1", exp: past }) }),
        null,
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });

  it("AC-7: pamięć z tego dnia i tego konta — bez zapytania", () => {
    expect(
      dutyDecision(
        session({}),
        memory({ sub: "u1", day: "2026-11-20", duty: true }),
        NOW,
      ),
    ).toEqual({ kind: "remembered", duty: true });
    expect(
      dutyDecision(
        session({}),
        memory({ sub: "u1", day: "2026-11-20", duty: false }),
        NOW,
      ),
    ).toEqual({ kind: "remembered", duty: false });
  });

  it("AC-8: inny dzień (Europe/Warsaw), inne sub albo zły format — pytamy ponownie", () => {
    expect(
      dutyDecision(
        session({}),
        memory({ sub: "u1", day: "2026-11-19", duty: true }),
        NOW,
      ).kind,
    ).toBe("ask");
    expect(
      dutyDecision(
        session({}),
        memory({ sub: "u2", day: "2026-11-20", duty: true }),
        NOW,
      ).kind,
    ).toBe("ask");
    expect(
      dutyDecision(
        session({}),
        memory({ sub: "u1", day: "2026-11-20", duty: "tak" }),
        NOW,
      ).kind,
    ).toBe("ask");
    expect(dutyDecision(session({}), "nie-json", NOW).kind).toBe("ask");
    // 23:30 UTC 20.11 = 00:30 21.11 w Warszawie — nowy dzień
    const late = new Date("2026-11-20T23:30:00Z");
    const lateSession = session({}, Math.floor(late.getTime() / 1000) + 3600);
    expect(
      dutyDecision(
        lateSession,
        memory({ sub: "u1", day: "2026-11-20", duty: true }),
        late,
      ).kind,
    ).toBe("ask");
  });

  it("format pamięci { sub, day, duty } z dniem w Europe/Warsaw", () => {
    expect(
      parseDutyMemory(
        serializeDutyMemory("u1", true, new Date("2026-11-20T23:30:00Z")),
      ),
    ).toEqual({
      sub: "u1",
      day: "2026-11-21",
      duty: true,
    });
    expect(parseDutyMemory(null)).toBeNull();
    expect(parseDutyMemory("null")).toBeNull();
  });

  it("AC-5: błąd odpowiedzi (401, 5xx, inna treść) — brak wyniku do zapamiętania", () => {
    expect(dutyFromResponse(true, true)).toBe(true);
    expect(dutyFromResponse(true, false)).toBe(false);
    expect(dutyFromResponse(false, true)).toBeNull();
    expect(dutyFromResponse(true, { message: "x" })).toBeNull();
    expect(dutyFromResponse(true, null)).toBeNull();
  });

  it("AC-1, AC-2: link tylko dla roli user z wynikiem true", () => {
    expect(showDutyLink(session({ app_role: "user" }), true)).toBe(true);
    expect(showDutyLink(session({ app_role: "user" }), false)).toBe(false);
    expect(showDutyLink(null, true)).toBe(false);
  });
});

describe("pamięć w sessionStorage (SPEC-009 AC-9, AC-10)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubStorage(): Map<string, string> {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    vi.stubGlobal("window", { sessionStorage: storage, localStorage: storage });
    return data;
  }

  it("AC-9: zapis wyniku pod kluczem sv-duty-link", () => {
    const data = stubStorage();
    rememberDuty("u1", true);
    expect(parseDutyMemory(data.get(DUTY_LINK_KEY) ?? null)).toMatchObject({
      sub: "u1",
      duty: true,
    });
  });

  it("AC-10: wylogowanie usuwa pamięć", () => {
    const data = stubStorage();
    rememberDuty("u1", true);
    forgetDuty();
    expect(data.has(DUTY_LINK_KEY)).toBe(false);
  });

  it("brak sessionStorage — bez błędu", () => {
    expect(() => rememberDuty("u1", true)).not.toThrow();
    expect(() => forgetDuty()).not.toThrow();
  });
});
