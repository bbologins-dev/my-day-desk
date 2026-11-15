export const demoSources = {
  kovo: { label: 'Kovo', prefix: 'Kovo Fitness demo: ', hostname: 'kovofitness.com' },
  exsercise: { label: 'Exsercise', prefix: 'Exsercise demo: ', hostname: 'exsercise.com' },
}

export type DemoSource = keyof typeof demoSources
export const demoKeys = Object.keys(demoSources) as DemoSource[]
export type Exercise = { name: string } & Record<DemoSource, string>
export type Workout = { warmUp: boolean; coolDown: boolean; exercises: Exercise[] }

export const detailsLimit = 8000

export function blankExercise(): Exercise {
  return { name: '', kovo: '', exsercise: '' }
}

export function isDemoUrl(value: string, source: DemoSource) {
  try {
    const url = new URL(value)
    return /^https?:\/\/[^\s]+$/i.test(value)
      && !url.username && !url.password
      && url.hostname.replace(/^www\./, '') === demoSources[source].hostname
  } catch {
    return false
  }
}

// Existing text plans retain their storage format and are only parsed when
// every line belongs to the workout format.
export function parseWorkout(text: string): Workout | null {
  const blocks = text.trim().split(/\r?\n(?:[ \t]*\r?\n)+/)
  const warmUp = blocks[0] === 'Warm-up'
  const coolDown = blocks.at(-1) === 'Cool-down'
  const exercises: Exercise[] = []

  for (const block of blocks.slice(warmUp ? 1 : 0, coolDown ? -1 : undefined)) {
    const [heading, ...links] = block.split(/\r?\n/)
    const name = heading.match(/^(\d+)\. (\S.*)$/)
    if (!name || Number(name[1]) !== exercises.length + 1) return null

    const exercise = { ...blankExercise(), name: name[2] }
    for (const line of links) {
      const source = demoKeys.find(key => line.startsWith(demoSources[key].prefix))
      if (!source || exercise[source]) return null
      const url = line.slice(demoSources[source].prefix.length)
      if (!isDemoUrl(url, source)) return null
      exercise[source] = url
    }
    exercises.push(exercise)
  }

  return exercises.length ? { warmUp, coolDown, exercises } : null
}

export function formatWorkout({ warmUp, coolDown, exercises }: Workout) {
  const blocks = exercises.map((exercise, index) => {
    const links = demoKeys.filter(key => exercise[key])
      .map(key => demoSources[key].prefix + exercise[key])
    return [`${index + 1}. ${exercise.name}`, ...links].join('\n')
  })

  if (warmUp) blocks.unshift('Warm-up')
  if (coolDown) blocks.push('Cool-down')
  return blocks.join('\n\n')
}
