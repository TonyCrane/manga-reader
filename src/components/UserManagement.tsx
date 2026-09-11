import { useState } from "react";
import { Plus, KeyRound } from "lucide-react";
import { Sheet } from "./Sheet";
import { api, json } from "../api";
import { useAccount } from "../account";
import type { User } from "../types";

export function UserManagement({
  users,
  onChanged,
}: {
  users: User[];
  onChanged: () => Promise<void>;
}) {
  const { user, setUser } = useAccount();
  const [create, setCreate] = useState(false);
  const [reset, setReset] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function perform(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel users-panel">
      <div className="panel-heading">
        <h2>用户管理</h2>
        <button
          className="primary"
          onClick={() => {
            setError("");
            setCreate(true);
          }}
        >
          <Plus size={17} />
          创建用户
        </button>
      </div>
      {users.map((account) => (
        <div className="user-row" key={account.id}>
          <div className="user-info">
            <strong>{account.email}</strong>
            {account.mustChangePassword && <small>待修改初始密码</small>}
          </div>
          <label className="admin-checkbox">
            <input
              type="checkbox"
              aria-label={`${account.email} 管理员`}
              checked={account.isAdmin}
              disabled={busy}
              onChange={(event) => {
                const isAdmin = event.target.checked;
                void perform(async () => {
                  const changed = await api<User>(
                    `/users/${account.id}`,
                    json("PATCH", { isAdmin }),
                  );
                  if (account.id === user.id) {
                    setUser(changed);
                  }
                  if (account.id !== user.id || changed.isAdmin) {
                    await onChanged();
                  }
                });
              }}
            />
            管理员
          </label>
          <button
            className="soft-button"
            aria-label={`重置 ${account.email} 的密码`}
            onClick={() => {
              setError("");
              setReset(account);
            }}
          >
            <KeyRound size={16} />
            重置密码
          </button>
        </div>
      ))}
      {error && !create && !reset && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {create && (
        <Sheet
          className="account-sheet"
          title="创建用户"
          onClose={() => setCreate(false)}
        >
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void perform(async () => {
                await api(
                  "/users",
                  json("POST", {
                    email: form.get("email"),
                    password: form.get("password"),
                    isAdmin: form.get("isAdmin") === "on",
                  }),
                );
                setCreate(false);
                await onChanged();
              });
            }}
          >
            <label>
              邮箱
              <input
                type="email"
                name="email"
                autoComplete="off"
                required
                maxLength={254}
              />
            </label>
            <label>
              初始密码
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            <label className="admin-checkbox">
              <input type="checkbox" name="isAdmin" />
              管理员
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary full" disabled={busy}>
              创建用户
            </button>
          </form>
        </Sheet>
      )}
      {reset && (
        <Sheet
          className="account-sheet"
          title="重置密码"
          onClose={() => setReset(null)}
        >
          <p className="muted">{reset.email}</p>
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void perform(async () => {
                await api(
                  `/users/${reset.id}/password`,
                  json("POST", { password: form.get("password") }),
                );
                if (reset.id === user.id) {
                  location.href = "/login";
                  return;
                }
                setReset(null);
                await onChanged();
              });
            }}
          >
            <label>
              初始密码
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary full" disabled={busy}>
              重置密码
            </button>
          </form>
        </Sheet>
      )}
    </section>
  );
}
