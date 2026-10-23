import { expect, test, vi } from "vitest";
import { ok } from "@shared/functional";

const authenticateJwt = vi.hoisted(() => vi.fn());
const authenticateSession = vi.hoisted(() => vi.fn());
const loadUserAccess = vi.hoisted(() => vi.fn());
vi.mock("@core/src/shared/infrastructure/jwt-verifier", () => ({ authenticateJwt }));
vi.mock("@core/src/shared/infrastructure/auth", () => ({ auth: { api: { getSession: authenticateSession } } }));
vi.mock("@core/src/features/users", () => ({ loadUserAccess }));
vi.mock("@core/src/features/companies/infrastructure/company-repository", () => ({ companyRepository: { findCompany: vi.fn() } }));
vi.mock("@core/src/features/users/infrastructure/user-repository", () => ({ userRepository: {} }));
import { resolveCurrentAccess } from "@core/src/shared/infrastructure/current-user";

const access = { status: "company_required", user: { id: "user-1", name: "Seller", emailVerified: true, companyId: null }, company: null };

test("exposes the session id of a bearer token as the access sessionId", async () => {
  authenticateJwt.mockResolvedValueOnce(ok({ userId: "user-1", sessionId: "sid-from-jwt" }));
  loadUserAccess.mockResolvedValueOnce(ok(access));
  expect(await resolveCurrentAccess(new Headers({ authorization: "Bearer a.b.c" }))).toEqual(ok({ ...access, sessionId: "sid-from-jwt" }));
});

test("exposes the session id of a cookie session as the access sessionId", async () => {
  authenticateSession.mockResolvedValueOnce({ user: { id: "user-1" }, session: { id: "cookie-session" } });
  loadUserAccess.mockResolvedValueOnce(ok(access));
  expect(await resolveCurrentAccess(new Headers({ cookie: "session=1" }))).toEqual(ok({ ...access, sessionId: "cookie-session" }));
});
