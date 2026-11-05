import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Sample } from '../types'

const PANE = 'contexto'
const WARN = 70 // % del contexto a partir del cual se avisa
const HARD = 95 // por encima de esto la compactación automática no se bloquea (evita un error por contexto lleno)
const BAR = 30

const history = atom({ plugin: 'contexto-guard', key: 'history' } as const, [], {
  shape: 'history-1',
})
const approved = atom({ plugin: 'contexto-guard', key: 'approved' } as const, false)
const pending = atom({ plugin: 'contexto-guard', key: 'pending' } as const, false)
const bandHidden = atom({ plugin: 'contexto-guard', key: 'bandHidden' } as const, false)

const bar = (percent: number, width = BAR) => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const SPARK = '▁▂▃▄▅▆▇█'
const spark = (list: readonly Sample[]) =>
  list.map(s => SPARK[Math.min(7, Math.floor((s.percent / 100) * 8))]).join('')

const k = (n: number) => `${Math.round(n / 1000)}k`

const colorFor = (percent: number) => (percent >= 85 ? 'red' : percent >= WARN ? 'yellow' : 'green')

const compactNow = async ($: EngineInterface) => {
  await update($, approved, () => true)
  try {
    const r = await $.session.compact()
    if ('skip' in r && r.skip) $.ui.toast(`Compactación omitida: ${r.skip}`)
  } catch {
    // Hay un turno en curso: queda permitida para la próxima compactación automática.
    $.ui.toast('Permitido: se compactará en cuanto termine el turno actual.')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'contexto',
      description: 'Muestra el uso de contexto y el estado de la compactación',
    })
    await $.command.register({
      name: 'permitir-compactar',
      description: 'Deja pasar la próxima compactación automática',
    })
    void $.ui.open({ id: PANE, title: 'Contexto' })
    return next(e)
  })

  on('command.run', { command: 'contexto' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Contexto' })
    const { context } = await $.session.usage()
    const percent = context.percent ?? 0
    const estado = (await read($, pending))
      ? 'compactación automática EN ESPERA: escribe /compact para compactar ya, o /permitir-compactar'
      : (await read($, approved))
        ? 'próxima compactación automática permitida'
        : `se pedirá permiso antes de compactar (salvo >= ${HARD}%)`
    return {
      text: `Contexto: ${bar(percent, 20)} ${percent}% (${k(context.tokens ?? 0)} / ${k(context.window)}) · ${estado}`,
    }
  })

  on('command.run', { command: 'permitir-compactar' }, async $ => {
    await update($, approved, () => true)
    await update($, pending, () => false)
    return { text: 'Permitido: la próxima compactación automática se hará sin preguntar. Para compactar ya, escribe /compact.' }
  })

  // La web no dibuja bandas de mods: el aviso se muestra como primera línea de la respuesta de Claude.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    try {
      const percent = (await read($, history)).at(-1)?.percent ?? 0
      const isPending = await read($, pending)
      if (percent < WARN && !isPending) return result
      const text = isPending
        ? `contexto-guard: la compactación automática está EN ESPERA del permiso del usuario (contexto al ${percent}%). Empieza tu respuesta con una línea: "⏸ Compactación en espera (${percent}%): escribe /compact para compactar ahora o /permitir-compactar para dejar pasar la automática."`
        : `contexto-guard: el contexto está al ${percent}%. Empieza tu respuesta con una línea: "⚠ Contexto al ${percent}%: pronto habrá que compactar. Escribe /compact cuando quieras o /permitir-compactar para dejar pasar la automática."`
      return { ...result, sections: [...result.sections, { id: 'contexto-guard', text, scope: 'session' as const }] }
    } catch {
      return result
    }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const { context } = await $.session.usage()
    if (context.percent !== undefined) {
      const prev = (await read($, history)).at(-1)?.percent ?? 0
      const sample: Sample = { percent: context.percent, tokens: context.tokens ?? 0 }
      await update($, history, list => [...list, sample].slice(-40))
      if (prev < WARN && context.percent >= WARN) {
        await update($, bandHidden, () => false)
        $.ui.toast(`Contexto al ${context.percent}%: pronto se compactará la conversación.`)
      }
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    if (e.trigger === 'precompute') return next(e)

    if (e.trigger === 'auto') {
      const hold = await (async () => {
        if (await read($, approved)) return false
        const { context } = await $.session.usage()
        if ((context.percent ?? 0) < HARD) return true
        $.ui.toast(`Contexto al ${context.percent}%: se compacta para no superar el límite.`)
        return false
      })().catch(() => false) // ante cualquier fallo, no bloquear la compactación
      if (hold) {
        await update($, pending, () => true).catch(() => undefined)
        await update($, bandHidden, () => false).catch(() => undefined)
        $.ui.toast('Compactación automática en espera: pulsa "Permitir y compactar".')
        return { skip: 'esperando tu permiso: escribe /compact para compactar ahora o /permitir-compactar' }
      }
    }

    const result = await next(e)
    if (!('skip' in result && result.skip)) {
      await update($, approved, () => false)
      await update($, pending, () => false)
      await update($, history, list => [...list, { percent: 0, tokens: 0 }].slice(-40))
      $.ui.toast('Conversación compactada.')
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isPending = await read($, pending)
    const last = (await read($, history)).at(-1)
    const percent = last?.percent ?? 0
    const show = !(await read($, bandHidden)) && (isPending || percent >= WARN)
    if (e.props.hasSurvey || !show) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isOk = await read($, approved)
    return (
      <Box flexDirection="column">
        <Text color={colorFor(percent)}>
          {isPending ? '⏸ Compactación automática en espera · ' : '⚠ '}
          Contexto {bar(percent, 20)} {percent}%
        </Text>
        <Box>
          <Button key="allow" label="Permitir y compactar" variant="primary" onPress={() => compactNow($)} />
          <Text> </Text>
          {!isOk && (
            <Button
              key="auto"
              label="Permitir la próxima automática"
              onPress={() => update($, approved, () => true)}
            />
          )}
          <Text> </Text>
          <Button key="pane" label="Ver gráfico" onPress={() => $.ui.open({ id: PANE, title: 'Contexto' })} />
          <Text> </Text>
          <Button key="hide" label="Ocultar" onPress={() => update($, bandHidden, () => true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const bd = context.breakdown
    const percent = context.percent ?? 0
    const list = await read($, history)
    const isPending = await read($, pending)
    const isOk = await read($, approved)
    const threshold =
      bd?.autoCompactThreshold !== undefined
        ? Math.round((bd.autoCompactThreshold / context.window) * 100)
        : undefined
    const rows = (bd?.categories ?? []).filter(c => c.kind !== 'deferred' && c.tokens > 0)
    const total = bd?.rawMaxTokens ?? context.window

    return (
      <Box flexDirection="column">
        <Text bold>Uso de contexto</Text>
        <Text color={colorFor(percent)}>
          {bar(percent)} {percent}%
        </Text>
        <Text dimColor>
          {k(context.tokens ?? 0)} de {k(context.window)} tokens
          {threshold !== undefined ? ` · auto-compactación ≈ ${threshold}%` : ''}
          {bd && !bd.isAutoCompactEnabled ? ' · auto-compactación desactivada' : ''}
        </Text>
        <Text> </Text>
        <Text bold>Por categoría</Text>
        {rows.length === 0 && <Text dimColor>Sin desglose todavía (aparece tras la primera respuesta).</Text>}
        {rows.map(c => {
          const p = Math.round((c.tokens / total) * 100)
          return (
            <Text>
              {bar(p, 15)} {String(p).padStart(3)}% {c.name} ({k(c.tokens)})
            </Text>
          )
        })}
        <Text> </Text>
        <Text bold>Historial por turno</Text>
        <Text>{list.length ? spark(list) : '—'}</Text>
        <Text> </Text>
        <Text>
          Estado:{' '}
          {isPending
            ? 'compactación automática EN ESPERA de tu permiso'
            : isOk
              ? 'próxima compactación permitida'
              : `se pedirá permiso antes de compactar (salvo ≥ ${HARD}%)`}
        </Text>
        <Box>
          <Button key="allow" label="Permitir y compactar ahora" variant="primary" onPress={() => compactNow($)} />
          <Text> </Text>
          <Button
            key="toggle"
            label={isOk ? 'Volver a pedir permiso' : 'Permitir la próxima automática'}
            onPress={() => update($, approved, v => !v)}
          />
        </Box>
      </Box>
    )
  })
}
