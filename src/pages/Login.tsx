import { useState } from "react";
import { api, json } from "../lib/api";
import type { User } from "../types";

export function Login({
  setup,
  onLogin,
}: {
  setup: boolean;
  onLogin: (user: User) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        className="account-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setError("");
          if (setup && data.get("password") !== data.get("confirm")) {
            setError("两次输入的密码不一致");
            return;
          }
          setBusy(true);
          try {
            const result = await api<{ user: User }>(
              setup ? "/setup" : "/login",
              json("POST", {
                email: data.get("email"),
                password: data.get("password"),
              }),
            );
            onLogin(result.user);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>{setup ? "创建管理员" : "登录"}</h1>
        <label>
          邮箱
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            maxLength={254}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            name="password"
            autoComplete={setup ? "new-password" : "current-password"}
            required
            minLength={8}
            maxLength={128}
          />
        </label>
        {setup && (
          <label>
            确认密码
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? "正在处理…" : setup ? "创建管理员" : "登录"}
        </button>
      </form>
    </div>
  );
}
