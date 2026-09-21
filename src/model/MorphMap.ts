import type { ModelConstructor } from "./Model.js";

export class MorphMap {
  private static map = new Map<string, ModelConstructor>();

  static register(name: string, model: ModelConstructor): void {
    this.map.set(name, model);
  }

  static get(name: string): ModelConstructor | undefined {
    return this.map.get(name);
  }

  static keys(): string[] {
    return Array.from(this.map.keys());
  }
}
