import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { collection, doc, getFirestore, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { ArrowDown, ArrowUp, ChevronDown, Dumbbell, GripVertical, LayoutGrid, Menu, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Sun, Trash2, Utensils, X } from 'lucide-react'
import { blankExercise, demoKeys, demoSources, detailsLimit, formatWorkout, isDemoUrl, parseWorkout } from './workout'
import type { DemoSource, Exercise, Workout } from './workout'
import exerciseMedia from './exercise-media.json'
import './style.css'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const firebase = Object.values(config).every(Boolean) ? initializeApp(config) : null
const auth = firebase && getAuth(firebase)
const db = firebase && getFirestore(firebase)
const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

const sections = {
  fitness: { title: 'Fitness', icon: Dumbbell, description: 'Plan your workouts and exercise routines.', singular: 'workout', plural: 'Workout plans', schedule: 'e.g. Monday and Thursday', details: 'Exercises', example: 'e.g. Squats — 3 sets of 10' },
  diet: { title: 'Diet', icon: Utensils, description: 'Plan your meals and keep food notes in one place.', singular: 'meal', plural: 'Meal plans', schedule: 'e.g. Weekdays', details: 'Meals', example: 'e.g. Breakfast — oats, yogurt and fruit' },
}
type Kind = keyof typeof sections
type Plan = { id: string; kind: Kind; title: string; schedule: string; details: string; notes: string }
type Theme = 'light' | 'dark'

function currentPage(): Kind {
  return location.pathname === '/diet' ? 'diet' : 'fitness'
}

function readTheme(key: string): Theme {
  try {
    return localStorage.getItem(key) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function ExerciseAnimation({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false)
  let slug = ''
  try { slug = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '' } catch {}
  const source = (exerciseMedia as Record<string, string>)[slug]
  if (!source || failed) return null
  return <img className="exercise-animation" src={source}
    alt={`Animated demonstration of ${name}`} width={160} height={160} loading="lazy"
    decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function PlanText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']*[^\s<>"'.,!?;:)\]])/gi)
  const labels = parts.map((part, index) => {
    if (index % 2 === 0) return null
    if (/^https?:\/\/(?:www\.)?kovofitness\.com\//i.test(part)) return 'Kovo'
    if (/^https?:\/\/(?:www\.)?exsercise\.com\//i.test(part)) return 'Exsercise'
    return null
  })

  return <p>{parts.map((part, index) => {
    if (index % 2 === 0) {
      if (!labels[index + 1]) return part
      const textBeforeLink = part.replace(/(^|\n)(?:(?:Kovo Fitness|Exsercise) demo|Demo): $/i, '$1')
      return labels[index - 1] && /^\r?\n$/.test(textBeforeLink) ? ' ' : textBeforeLink
    }

    const label = labels[index]
    return <a key={index} href={part} target="_blank" rel="noopener noreferrer"
      className={label ? 'demo-link' : undefined} title={label ? part : undefined}>{label ?? part}</a>
  })}</p>
}

function reorderExercises<T>(items: T[], from: number, to: number) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items
  const reordered = [...items]
  const [moved] = reordered.splice(from, 1)
  reordered.splice(to, 0, moved)
  return reordered
}

function useExerciseDrag(onMove: (from: number, to: number) => void) {
  const source = useRef<number | null>(null)
  const [target, setTarget] = useState<{ index: number; after: boolean } | null>(null)
  const clear = () => {
    source.current = null
    setTarget(null)
  }

  function isAfter(event: DragEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY >= rect.top + rect.height / 2
  }

  return {
    handle(index: number, enabled: boolean) {
      return {
        draggable: enabled,
        onDragStart(event: DragEvent<HTMLElement>) {
          source.current = index
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(index + 1))
        },
        onDragEnd: clear,
      }
    },
    row(index: number) {
      return {
        'data-drop-position': target?.index === index ? (target.after ? 'after' : 'before') : undefined,
        onDragOver(event: DragEvent<HTMLElement>) {
          if (source.current === null) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const after = isAfter(event)
          setTarget(previous => previous?.index === index && previous.after === after ? previous : { index, after })
        },
        onDragLeave(event: DragEvent<HTMLElement>) {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setTarget(previous => previous?.index === index ? null : previous)
        },
        onDrop(event: DragEvent<HTMLElement>) {
          const from = source.current
          if (from === null) return
          event.preventDefault()
          const to = index + Number(isAfter(event)) - Number(from < index)
          clear()
          if (from !== index) onMove(from, to)
        },
      }
    },
  }
}

function WorkoutDetails({ text, saveOrder }: { text: string; saveOrder: (details: string) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const workout = parseWorkout(text)
  async function move(from: number, to: number) {
    if (!workout || saving) return
    const exercises = reorderExercises(workout.exercises, from, to)
    if (exercises === workout.exercises) return
    setSaving(true)
    setFeedback('Saving exercise order…')
    try {
      await saveOrder(formatWorkout({ ...workout, exercises }))
      setFeedback(`${exercises[to].name} moved to position ${to + 1}.`)
    } catch {
      setFeedback('Could not save the order. Check the current list and try again.')
    } finally {
      setSaving(false)
    }
  }
  const drag = useExerciseDrag((from, to) => void move(from, to))
  if (!workout) {
    const source = text.match(/https?:\/\/(?:www\.)?kovofitness\.com\/exercises\/[^\s]+/)?.[0]
    return <div className="legacy-workout"><PlanText text={text} />
      {source && <ExerciseAnimation key={source} url={source} name={text.split('\n')[0]} />}
    </div>
  }

  return <div className="workout-details">
    {workout.warmUp && <div className="workout-phase">Warm-up</div>}
    <ol className="exercise-list">
      {workout.exercises.map((exercise, index) => <li key={index} {...drag.row(index)}>
        <div className="exercise-row">
          {workout.exercises.length > 1 && <span className="exercise-grip" aria-hidden="true"
            title="Drag to reorder" {...drag.handle(index, !saving)}><GripVertical size={17} /></span>}
          <strong>{exercise.name}</strong>
          <ExerciseAnimation key={exercise.kovo} url={exercise.kovo} name={exercise.name} />
          <div className="exercise-demos">
            {demoKeys.filter(key => exercise[key]).map(key => <a key={key} className="demo-link"
              href={exercise[key]} target="_blank" rel="noopener noreferrer"
              aria-label={`${demoSources[key].label} demo for ${exercise.name} (opens in a new tab)`}>
              {demoSources[key].label}
            </a>)}
          </div>
          {workout.exercises.length > 1 && <div className="exercise-order">
            <button className="icon-button" type="button" title="Move up" aria-label={`Move exercise ${index + 1} up`}
              disabled={saving || index === 0} onClick={() => void move(index, index - 1)}><ArrowUp size={14} /></button>
            <button className="icon-button" type="button" title="Move down" aria-label={`Move exercise ${index + 1} down`}
              disabled={saving || index === workout.exercises.length - 1} onClick={() => void move(index, index + 1)}><ArrowDown size={14} /></button>
          </div>}
        </div>
      </li>)}
    </ol>
    {workout.coolDown && <div className="workout-phase">Cool-down</div>}
    <div role="status" className="exercise-status">{feedback}</div>
  </div>
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(auth ? undefined : null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (auth) return onAuthStateChanged(auth, setUser)
  }, [])

  async function login() {
    if (!auth) {
      setError('Google sign-in has not been configured.')
      return
    }
    setWorking(true)
    setError('')
    try {
      await signInWithPopup(auth, provider)
    } catch (failure) {
      const code = (failure as { code?: string }).code
      if (code !== 'auth/popup-closed-by-user') setError('Google sign-in could not finish. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  if (user) return <MemberGate key={user.uid} user={user} />
  return <main className="gate">
    <div className="gate-card">
      <div className="mark gate-mark"><LayoutGrid size={22} /></div>
      <h1>My Day Desk</h1>
      {user !== undefined && <button className="google" disabled={working} onClick={() => void login()}>
        <span aria-hidden="true" className="google-g">G</span>{working ? 'Signing in…' : 'Sign in with Google'}
      </button>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </main>
}

function MemberGate({ user }: { user: User }) {
  const [access, setAccess] = useState<'checking' | 'invited' | 'denied' | 'error'>('checking')
  const [signOutError, setSignOutError] = useState(false)
  async function logout() {
    if (!auth) return
    setSignOutError(false)
    try {
      await signOut(auth)
    } catch {
      setSignOutError(true)
    }
  }
  useEffect(() => {
    if (!db || !user.email || !user.emailVerified) {
      setAccess('denied')
      return
    }
    return onSnapshot(doc(db, 'invitations', user.email), { includeMetadataChanges: true }, snapshot => {
      if (!snapshot.metadata.fromCache) setAccess(snapshot.exists() ? 'invited' : 'denied')
    }, () => setAccess('error'))
  }, [user])

  if (access === 'invited') return <Workspace user={user} logout={logout} signOutError={signOutError} />
  return <main className="gate">
    <div className="gate-card">
      <div className="mark gate-mark"><LayoutGrid size={22} /></div>
      <h1>My Day Desk</h1>
      <p role="status">{access === 'checking' ? 'Checking your invitation…' : access === 'denied' ? 'This Google account has no invitation.' : 'Your invitation could not be checked. Please sign in again.'}</p>
      <button className="button" onClick={() => void logout()}>Sign out</button>
      {signOutError && <p className="error" role="alert">Sign-out failed. Please try again.</p>}
    </div>
  </main>
}

function Workspace({ user, logout, signOutError }: { user: User; logout: () => Promise<void>; signOutError: boolean }) {
  const [kind, setKind] = useState(currentPage)
  const themeKey = 'my-day-desk-theme:' + user.uid
  const [theme, setTheme] = useState(() => readTheme(themeKey))
  const [collapsed, setCollapsed] = useState(false)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [editor, setEditor] = useState<Plan | 'new' | 'new-pull' | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [focusedRoutine, setFocusedRoutine] = useState<string | null>(null)
  const drawer = useRef<HTMLDialogElement>(null)
  const closeMenuButton = useRef<HTMLButtonElement>(null)
  const pointerOnBackdrop = useRef(false)
  const nativeLightDismiss = 'closedBy' in HTMLDialogElement.prototype
  const section = sections[kind]
  const visiblePlans = plans?.filter(plan => plan.kind === kind)
  const activeRoutine = kind === 'fitness' ? visiblePlans?.find(plan => plan.id === focusedRoutine) : undefined
  const workoutOrder = ['push', 'pull', 'leg exercises']
  const workoutCards = workoutOrder.flatMap(title => {
    const matches = visiblePlans?.filter(plan => plan.title.trim().toLowerCase() === title) ?? []
    return matches.length ? matches : title === 'pull' ? [null] : []
  })
  const displayedPlans = kind === 'fitness'
    ? [...workoutCards, ...(visiblePlans ?? []).filter(plan => !workoutOrder.includes(plan.title.trim().toLowerCase()))]
    : visiblePlans

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    return () => { delete document.documentElement.dataset.theme }
  }, [theme])

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 700px)')
    const closeDrawerOnDesktop = () => {
      if (!mobile.matches) drawer.current?.close()
    }
    mobile.addEventListener('change', closeDrawerOnDesktop)
    return () => mobile.removeEventListener('change', closeDrawerOnDesktop)
  }, [])

  useEffect(() => {
    const onBack = () => {
      setEditor(null)
      setKind(currentPage())
    }
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
  }, [])

  useEffect(() => {
    if (!db) return
    return onSnapshot(query(collection(db, 'users', user.uid, 'plans'), orderBy('updatedAt', 'desc')),
      { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
        setPlans(snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as Plan))
      }, () => {
        setPlans(null)
        setLoadError(true)
      })
  }, [user.uid])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(themeKey, next) } catch {}
    setTheme(next)
  }

  function navigate(event: React.MouseEvent<HTMLAnchorElement>, next: Kind) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (next !== kind) history.pushState(null, '', '/' + next)
    setKind(next)
    drawer.current?.close()
  }

  const themeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  const ThemeIcon = theme === 'dark' ? Sun : Moon
  function sidebar(mobile: boolean) {
    return <>
      <div className="side-header">
        <div className="mark"><LayoutGrid size={17} /></div>
        <span className="brand hide-collapsed">My Day Desk</span>
        <div className="side-tools">
          <button className="icon-button" type="button" aria-label={themeLabel} title={themeLabel} onClick={toggleTheme}><ThemeIcon size={17} /></button>
          <button className="icon-button" type="button" ref={mobile ? closeMenuButton : undefined} aria-label={mobile ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => mobile ? drawer.current?.close() : setCollapsed(!collapsed)}>
            {mobile ? <X size={17} /> : collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
      </div>
      <nav aria-label="Plans">
        <h2 className="nav-group hide-collapsed">Plans</h2>
        {(Object.keys(sections) as Kind[]).map(key => {
          const { icon: Icon, title } = sections[key]
          return <a key={key} href={'/' + key} onClick={event => navigate(event, key)} aria-label={title} aria-current={kind === key ? 'page' : undefined} title={title}>
            <Icon size={17} /><span className="hide-collapsed">{title}</span>
          </a>
        })}
      </nav>
      <div className="account">
        <span className="avatar" aria-hidden="true">{(user.displayName || user.email || '?')[0].toUpperCase()}</span>
        <div className="account-text"><strong className="hide-collapsed">{user.displayName || user.email}</strong><button className="text-button" onClick={() => void logout()}>Sign out</button></div>
      </div>
    </>
  }

  async function save(plan: Omit<Plan, 'id'>) {
    if (!db) throw new Error('Firestore is not configured')
    const plansRef = collection(db, 'users', user.uid, 'plans')
    const planRef = editor && typeof editor !== 'string' ? doc(plansRef, editor.id) : doc(plansRef)
    await setDoc(planRef, { ...plan, updatedAt: serverTimestamp() })
    setEditor(null)
  }

  async function saveExerciseOrder(plan: Plan, details: string) {
    if (!db) throw new Error('Firestore is not configured')
    const planRef = doc(db, 'users', user.uid, 'plans', plan.id)
    await runTransaction(db, async transaction => {
      const current = await transaction.get(planRef)
      if (current.data()?.details !== plan.details) throw new Error('The exercise list changed')
      transaction.update(planRef, { details, updatedAt: serverTimestamp() })
    })
  }

  return <div className={'workspace' + (collapsed ? ' collapsed' : '')}>
    <aside className="desktop-sidebar">{sidebar(false)}</aside>
    <header className="mobile-bar"><button className="icon-button" aria-label="Open menu" aria-controls="mobile-navigation"
      aria-expanded={drawerOpen} onClick={() => {
        drawer.current?.showModal()
        closeMenuButton.current?.focus()
        setDrawerOpen(true)
      }}><Menu size={21} /></button><strong>My Day Desk</strong></header>
    <dialog className="drawer" id="mobile-navigation" ref={drawer} aria-label="Navigation" closedby="any"
      onClose={() => setDrawerOpen(false)}
      onPointerDown={nativeLightDismiss ? undefined : event => { pointerOnBackdrop.current = event.target === event.currentTarget }}
      onClick={nativeLightDismiss ? undefined : event => {
        if (pointerOnBackdrop.current && event.target === event.currentTarget) event.currentTarget.close()
        pointerOnBackdrop.current = false
      }}>
      <aside>{sidebar(true)}</aside>
    </dialog>
    <main className="content" id="main-content">
      <header className="page-header">
        <div><h1>{section.title}</h1><p>{section.description}</p></div>
        <button className="button primary" disabled={plans === null} onClick={() => setEditor('new')}><Plus size={18} /> Add {section.singular} plan</button>
      </header>
      {signOutError && <p className="error" role="alert">Sign-out failed. Please try again.</p>}
      <section className={`panel${activeRoutine ? ' routine-focus' : ''}`} aria-labelledby="plan-heading">
        <div className="panel-header"><h2 id="plan-heading">{activeRoutine ? activeRoutine.title : section.plural}</h2>
          {activeRoutine ? <button className="button" onClick={() => setFocusedRoutine(null)}>All routines</button>
            : <p>{visiblePlans ? visiblePlans.length + (visiblePlans.length === 1 ? ' plan' : ' plans') : ''}</p>}</div>
        {loadError ? <p className="error" role="alert">Plans could not be loaded. Refresh the page to try again.</p>
          : !visiblePlans ? <p className="muted" role="status">Loading plans…</p>
          : visiblePlans.length === 0 ? <div className="empty"><span className="mark"><section.icon size={21} /></span><h3>No {section.singular} plans yet</h3><p>Use “Add {section.singular} plan” to write your first one.</p></div>
          : <div className={kind === 'fitness' ? activeRoutine ? 'routine-content' : 'workout-board' : 'plan-list'}
              role={kind === 'fitness' ? 'region' : undefined}
              aria-label={kind === 'fitness' ? 'Workout plan cards' : undefined}
              tabIndex={kind === 'fitness' ? 0 : undefined}>
            {(activeRoutine ? [activeRoutine] : displayedPlans)?.map(plan => plan ? <details className="plan" key={plan.id}
              open={kind === 'fitness' ? !!activeRoutine : undefined}>
            <summary onClick={kind === 'fitness' ? event => {
              event.preventDefault()
              setFocusedRoutine(activeRoutine ? null : plan.id)
            } : undefined}><div className="plan-heading"><strong>{plan.title}</strong>{plan.schedule && <span>{plan.schedule}</span>}</div><ChevronDown size={17} /></summary>
            <div className="plan-body"><h3>{section.details}</h3>
              {kind === 'fitness' ? <WorkoutDetails text={plan.details} saveOrder={details => saveExerciseOrder(plan, details)} /> : <PlanText text={plan.details} />}
              {plan.notes && <><h3>Notes</h3><PlanText text={plan.notes} /></>}
              <button className="button" onClick={() => setEditor(plan)}><Pencil size={15} />Edit plan</button></div>
          </details> : <div className="plan workout-placeholder" key="new-pull">
            <h3>Pull</h3>
            <button className="button" onClick={() => setEditor('new-pull')}><Plus size={15} /> Add Pull plan</button>
          </div>)}</div>}
      </section>
    </main>
    {editor && <PlanEditor kind={kind} plan={typeof editor === 'string' ? undefined : editor}
      initialTitle={editor === 'new-pull' ? 'Pull' : undefined} close={() => setEditor(null)} save={save} />}
  </div>
}

type ExerciseRow = Exercise & { id: number }

function WorkoutFields({ initial, disabled }: { initial: Workout; disabled: boolean }) {
  const nextId = useRef(initial.exercises.length)
  const [rows, setRows] = useState<ExerciseRow[]>(() =>
    initial.exercises.map((exercise, id) => ({ ...exercise, id })))

  const moveExercise = (from: number, to: number) => setRows(current => reorderExercises(current, from, to))
  const drag = useExerciseDrag(moveExercise)

  return <fieldset className="exercise-fields" hidden={disabled} disabled={disabled}>
    <legend>Exercises</legend>
    <label className="phase-option"><input name="warmUp" type="checkbox" defaultChecked={initial.warmUp} /> Warm-up</label>
    {rows.map((row, index) => <fieldset className="exercise-fields-row" key={row.id} {...drag.row(index)}>
      <legend>{rows.length > 1 && <span className="exercise-grip" aria-hidden="true"
        title="Drag to reorder" {...drag.handle(index, !disabled)}><GripVertical size={16} /></span>}Exercise {index + 1}</legend>
      <label>Name<input name="exerciseName" required defaultValue={row.name} /></label>
      <div className="demo-fields">
        {demoKeys.map(key => <label key={key}>{demoSources[key].label} URL
          <input name={key} type="url" placeholder="https://" defaultValue={row[key]} />
        </label>)}
      </div>
      <div className="exercise-actions">
        <button className="button" type="button" aria-label={`Move exercise ${index + 1} up`}
          disabled={index === 0} onClick={() => moveExercise(index, index - 1)}><ArrowUp size={14} /> Move up</button>
        <button className="button" type="button" aria-label={`Move exercise ${index + 1} down`}
          disabled={index === rows.length - 1} onClick={() => moveExercise(index, index + 1)}><ArrowDown size={14} /> Move down</button>
        <button className="button remove-exercise" type="button" aria-label={`Remove exercise ${index + 1}`}
          disabled={rows.length === 1}
          onClick={() => setRows(current => current.filter(exercise => exercise.id !== row.id))}><Trash2 size={14} /> Remove</button>
      </div>
    </fieldset>)}
    <button className="button" type="button" onClick={() => {
      const id = nextId.current++
      setRows(current => [...current, { ...blankExercise(), id }])
    }}><Plus size={15} /> Add exercise</button>
    <label className="phase-option"><input name="coolDown" type="checkbox" defaultChecked={initial.coolDown} /> Cool-down</label>
  </fieldset>
}

function PlanEditor({ kind, plan, initialTitle, close, save }: { kind: Kind; plan?: Plan; initialTitle?: string; close: () => void; save: (plan: Omit<Plan, 'id'>) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const section = sections[kind]
  const [workout] = useState(() => {
    if (kind !== 'fitness') return null
    return plan ? parseWorkout(plan.details) : { warmUp: false, coolDown: false, exercises: [blankExercise()] }
  })
  const [writeAsText, setWriteAsText] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title')).trim()
    let details = String(data.get('details') ?? '').trim()
    if (workout && !writeAsText) {
      const urls = (key: DemoSource) => data.getAll(key).map(value => String(value).trim())
      const kovo = urls('kovo')
      const exsercise = urls('exsercise')
      const exercises = data.getAll('exerciseName').map((name, index) => ({
        name: String(name).trim(), kovo: kovo[index], exsercise: exsercise[index],
      }))
      const invalidRow = exercises.findIndex(exercise => !exercise.name
        || demoKeys.some(key => exercise[key] && !isDemoUrl(exercise[key], key)))
      if (invalidRow !== -1) {
        setError(`Check the name and demo URLs for exercise ${invalidRow + 1}.`)
        return
      }
      details = formatWorkout({ warmUp: data.has('warmUp'), coolDown: data.has('coolDown'), exercises })
    }
    if (!title || !details) {
      setError('Enter a title and plan details.')
      return
    }
    if (details.length > detailsLimit) {
      setError('Shorten the exercise names or demo URLs before saving this plan.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await save({ kind, title, details, schedule: String(data.get('schedule')).trim(), notes: String(data.get('notes') ?? '').trim() })
    } catch {
      setError('The plan could not be saved. Your edits are still here. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return <dialog ref={dialog} className="editor" aria-labelledby="editor-title" onCancel={event => { event.preventDefault(); if (!saving) close() }}>
    <form onSubmit={event => void submit(event)}>
      <div className="editor-header"><h2 id="editor-title">{plan ? 'Edit' : 'Add'} {section.singular} plan</h2><button className="icon-button" type="button" aria-label="Close editor" disabled={saving} onClick={close}><X size={19} /></button></div>
      <label>Title<input name="title" maxLength={100} required autoFocus defaultValue={plan?.title ?? initialTitle} /></label>
      <label>Schedule <span className="muted">(optional)</span><input name="schedule" maxLength={100} placeholder={section.schedule} defaultValue={plan?.schedule} /></label>
      {kind === 'fitness' && !plan && <label className="phase-option">
        <input type="checkbox" checked={writeAsText} onChange={event => setWriteAsText(event.target.checked)} /> Write exercises as text
      </label>}
      {workout && <WorkoutFields initial={workout} disabled={writeAsText} />}
      {(!workout || !plan) && <label hidden={!!workout && !writeAsText}>{section.details}
        <textarea name="details" rows={5} maxLength={detailsLimit} required disabled={!!workout && !writeAsText}
          placeholder={section.example} defaultValue={plan?.details} />
      </label>}
      <details className="optional" open={plan?.notes ? true : undefined}><summary>Notes <span className="muted">(optional)</span></summary><textarea aria-label="Notes" name="notes" rows={3} maxLength={4000} defaultValue={plan?.notes} /></details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="editor-actions"><button className="button" type="button" disabled={saving} onClick={close}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button></div>
    </form>
  </dialog>
}

createRoot(document.getElementById('root')!).render(<App />)
