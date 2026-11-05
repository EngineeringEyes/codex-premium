export type Sample = { percent: number; tokens: number }

declare module 'claude-code' {
  interface PluginState {
    'contexto-guard': {
      history: Shaped<Sample[]>
      approved: boolean
      pending: boolean
      bandHidden: boolean
    }
  }
}
