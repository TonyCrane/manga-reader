export type LibraryRouteState = {
  origin: "library";
};

export type MangaRouteState = {
  origin: "manga";
  mangaId: string;
  libraryBehind: boolean;
};

export type DetailViewState = {
  mangaId: string;
  view: "chapters" | "preview";
  ascending: boolean;
  previewPage: number;
  scrollY: number;
};

type DetailHistoryState = {
  origin?: "library";
  detailView: DetailViewState;
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

export function detailHistoryState(
  state: unknown,
  detailView: DetailViewState,
): DetailHistoryState {
  return {
    ...(isLibraryRouteState(state) ? libraryRouteState : {}),
    detailView,
  };
}

export function getDetailViewState(
  state: unknown,
  mangaId: string | undefined,
): DetailViewState | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !("detailView" in state) ||
    typeof state.detailView !== "object" ||
    state.detailView === null
  ) {
    return null;
  }
  const detailView = state.detailView;
  if (
    !("mangaId" in detailView) ||
    detailView.mangaId !== mangaId ||
    !("view" in detailView) ||
    (detailView.view !== "chapters" && detailView.view !== "preview") ||
    !("ascending" in detailView) ||
    typeof detailView.ascending !== "boolean" ||
    !("previewPage" in detailView) ||
    !Number.isSafeInteger(detailView.previewPage) ||
    (detailView.previewPage as number) < 0 ||
    !("scrollY" in detailView) ||
    typeof detailView.scrollY !== "number" ||
    !Number.isFinite(detailView.scrollY) ||
    detailView.scrollY < 0
  ) {
    return null;
  }
  return detailView as DetailViewState;
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
