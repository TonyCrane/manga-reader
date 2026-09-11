import { useEffect, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { BookOpen, Settings } from "lucide-react";
import { api, json } from "./api";
import { AccountContext } from "./account";
import type { User } from "./types";
import { Library } from "./pages/Library";
import { SettingsPage } from "./pages/Settings";
import { SystemSettings } from "./pages/SystemSettings";
import { Detail } from "./pages/Detail";
import { Reader } from "./reader/Reader";
import { Login } from "./pages/Login";
import { PasswordForm } from "./components/PasswordForm";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light",
  );
  const navigate = useNavigate();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  useEffect(() => {
    api<{ needsSetup: boolean }>("/setup")
      .then(async (status) => {
        setSetup(status.needsSetup);
        if (!status.needsSetup) {
          try {
            setUser((await api<{ user: User }>("/session")).user);
          } catch {
            setUser(null);
          }
        }
      })
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) {
      return;
    }
    const refresh = () => {
      void api<{ user: User }>("/session")
        .then((result) => setUser(result.user))
        .catch(() => setUser(null));
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("account-required", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("account-required", refresh);
    };
  }, [user?.id]);
  async function logout() {
    await api("/logout", json("POST", {}));
    setUser(null);
    navigate("/");
  }
  if (loading) {
    return <div className="loading">正在加载…</div>;
  }
  if (error) {
    return (
      <div className="loading">
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>重试</button>
      </div>
    );
  }
  if (!user) {
    return (
      <Login
        setup={setup}
        onLogin={(user) => {
          setUser(user);
          setSetup(false);
          navigate("/");
        }}
      />
    );
  }
  return (
    <AccountContext.Provider value={{ user, setUser }}>
      {user.mustChangePassword ? (
        <div className="login">
          <section className="password-required">
            <h1>修改初始密码</h1>
            <p className="muted">{user.email}</p>
            <PasswordForm onChanged={setUser} />
            <button className="soft-button full" onClick={logout}>
              退出登录
            </button>
          </section>
        </div>
      ) : (
        <Routes>
          <Route path="/read/:id/:chapterId" element={<Reader />} />
          <Route
            path="*"
            element={
              <>
                <footer className="bottom-nav">
                  <nav>
                    <NavLink to="/" end>
                      <BookOpen size={18} />
                      书架
                    </NavLink>
                    <NavLink to="/settings">
                      <Settings size={18} />
                      设置
                    </NavLink>
                  </nav>
                </footer>
                <main className="app-main">
                  <Routes>
                    <Route path="/" element={<Library />} />
                    <Route path="/manga/:id" element={<Detail />} />
                    <Route
                      path="/settings"
                      element={
                        <SettingsPage
                          theme={theme}
                          setTheme={setTheme}
                          onLogout={logout}
                        />
                      }
                    />
                    <Route
                      path="/settings/system"
                      element={
                        user.isAdmin ? (
                          <SystemSettings />
                        ) : (
                          <Navigate to="/settings" replace />
                        )
                      }
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </>
            }
          />
        </Routes>
      )}
    </AccountContext.Provider>
  );
}
