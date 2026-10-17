import { MAX_CACHE_PAGES } from "./model";

export class PageHistory {
  private screens = new Map<number, { keys: string[]; layout: string }>();
  private predecessors = new Map<number, number>();
  private navigation?: { from: number; direction: number; repeated: boolean };

  cancelNavigation() {
    this.navigation = undefined;
  }

  navigate(from: number | undefined, direction: number) {
    if (from === undefined) {
      this.navigation = undefined;
      return;
    }
    if (this.navigation) this.navigation.repeated = true;
    else this.navigation = { from, direction, repeated: false };
  }

  record(location: number | undefined, keys: string[], layout = "") {
    const navigation = this.navigation;
    this.navigation = undefined;
    if (location === undefined) return;
    const existing = this.screens.get(location);
    if (
      existing &&
      (existing.keys.join("|") !== keys.join("|") || existing.layout !== layout)
    )
      this.clear();
    this.screens.set(location, { keys, layout });
    if (
      navigation &&
      !navigation.repeated &&
      Math.sign(location - navigation.from) === navigation.direction
    ) {
      const earlier = Math.min(location, navigation.from);
      const later = Math.max(location, navigation.from);
      this.predecessors.set(later, earlier);
    }
    while (this.screens.size > MAX_CACHE_PAGES) {
      const oldest = this.screens.keys().next().value!;
      this.screens.delete(oldest);
      this.predecessors.delete(oldest);
      for (const [later, earlier] of this.predecessors)
        if (earlier === oldest) this.predecessors.delete(later);
    }
  }

  previous(location: number | undefined) {
    const earlier =
      location === undefined ? undefined : this.predecessors.get(location);
    if (earlier === undefined) return;
    const screen = this.screens.get(earlier);
    return screen ? { location: earlier, ...screen } : undefined;
  }

  previewPrevious(location: number | undefined) {
    const navigation = this.navigation;
    if (
      location === undefined ||
      !navigation ||
      navigation.repeated ||
      Math.sign(location - navigation.from) !== navigation.direction
    )
      return;
    const known = this.previous(location);
    if (known) return known;
    if (navigation.direction !== 1) return;
    const screen = this.screens.get(navigation.from);
    return screen ? { location: navigation.from, ...screen } : undefined;
  }

  clear() {
    this.screens.clear();
    this.predecessors.clear();
    this.navigation = undefined;
  }
}
