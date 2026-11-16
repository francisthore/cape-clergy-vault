import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountContext } from "@/lib/auth/account-context";
import { AccountActions } from "./AccountActions";
afterEach(cleanup);
describe("authentication-aware home actions", () => {
  it.each(["loading", "error"])("conceals guest and privileged actions while %s", (status) => {
    render(
      <AccountContext.Provider value={{ status, canReview: true, canCoordinate: true }}>
        <AccountActions />
      </AccountContext.Provider>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("shows registration and login only for a confirmed guest", () => {
    render(
      <AccountContext.Provider value={{ status: "signed-out" }}>
        <AccountActions />
      </AccountContext.Provider>,
    );
    expect(screen.getByRole("link", { name: "Register as clergy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to your account" })).toBeInTheDocument();
  });
  it("shows registration status for pending clergy", () => {
    render(
      <AccountContext.Provider value={{ status: "pending" }}>
        <AccountActions />
      </AccountContext.Provider>,
    );
    expect(screen.getByRole("link", { name: /View registration status/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Register as clergy" })).not.toBeInTheDocument();
  });
  it("combines independently trusted capabilities", () => {
    render(
      <AccountContext.Provider
        value={{
          status: "approved",
          canUseRepository: true,
          canApprove: true,
          canCoordinate: true,
          canReview: true,
          canManageAccess: true,
        }}
      >
        <AccountActions />
      </AccountContext.Provider>,
    );
    for (const name of [
      /Create a submission/,
      /Browse repository/,
      /View my submissions/,
      /Manage clergy registrations/,
      /TEFT submission inbox/,
      /Reviewer workspace/,
      /Manage delegated access/,
    ])
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    expect(screen.queryByText("Register as clergy")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in to your account")).not.toBeInTheDocument();
  });
});
