import { useState } from "react";
import { api, json } from "../lib/api";
import type { User } from "../types";

export function PasswordForm({
  onChanged,
}: {
  onChanged: (user: User) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  return (
    <form
      className="account-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setError("");
        setSuccess(false);
        if (data.get("password") !== data.get("confirm")) {
          setError("两次输入的密码不一致");
          return;
        }
        setBusy(true);
        try {
          const result = await api<{ user: User }>(
            "/account/password",
            json("POST", {
              currentPassword: data.get("currentPassword"),
              password: data.get("password"),
            }),
          );
          form.reset();
          onChanged(result.user);
          setSuccess(true);
        } catch (error) {
          setError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        当前密码
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        新密码
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
        />
      </label>
      <label>
        确认新密码
        <input
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="hint">
          密码已修改
        </p>
      )}
      <button className="primary full" disabled={busy}>
        修改密码
      </button>
    </form>
  );
}
