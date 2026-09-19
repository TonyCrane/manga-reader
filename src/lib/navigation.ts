export type LibraryRouteState = {
  origin: "library";
};

export type MangaRouteState = {
  origin: "manga";
  mangaId: string;
  libraryBehind: boolean;
};

export type SettingsRouteState = {
  origin: "settings";
};

export const libraryRouteState: LibraryRouteState = {
  origin: "library",
};

export const settingsRouteState: SettingsRouteState = {
  origin: "settings",
};

export function mangaRouteState(
  mangaId: string,
  libraryBehind: boolean,
): MangaRouteState {
  return {
    origin: "manga",
    mangaId,
    libraryBehind,
  };
}

export function isLibraryRouteState(
  state: unknown,
): state is LibraryRouteState {
  return (
    typeof state === "object" &&
    state !== null &&
    "origin" in state &&
    state.origin === "library"
  );
}

export function isMangaRouteState(
  state: unknown,
  mangaId: string | undefined,
): state is MangaRouteState {
  return (
    typeof state === "object" &&
    state !== null &&
    "origin" in state &&
    state.origin === "manga" &&
    "mangaId" in state &&
    state.mangaId === mangaId &&
    "libraryBehind" in state &&
    typeof state.libraryBehind === "boolean"
  );
}

export function isSettingsRouteState(
  state: unknown,
): state is SettingsRouteState {
  return (
    typeof state === "object" &&
    state !== null &&
    "origin" in state &&
    state.origin === "settings"
  );
}
