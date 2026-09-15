import { createContext, useContext } from "react";
import type { User } from "../types";

export const AccountContext = createContext<{
  user: User;
  setUser: (user: User) => void;
} | null>(null);
export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) {
    throw Error("账号上下文不存在");
  }
  return context;
}
