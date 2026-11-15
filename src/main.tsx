import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { collection, doc, getFirestore, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { ChevronDown, Dumbbell, LayoutGrid, Menu, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Sun, Utensils, X } from 'lucide-react'
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
  const [editor, setEditor] = useState<Plan | 'new' | null>(null)
  const drawer = useRef<HTMLDialogElement>(null)
  const section = sections[kind]
  const visiblePlans = plans?.filter(plan => plan.kind === kind)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    return () => { delete document.documentElement.dataset.theme }
  }, [theme])

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
          <button className="icon-button" type="button" aria-label={mobile ? 'Close menu' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => mobile ? drawer.current?.close() : setCollapsed(!collapsed)}>
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
    const planRef = editor && editor !== 'new' ? doc(plansRef, editor.id) : doc(plansRef)
    await setDoc(planRef, { ...plan, updatedAt: serverTimestamp() })
    setEditor(null)
  }

  return <div className={'workspace' + (collapsed ? ' collapsed' : '')}>
    <aside className="desktop-sidebar">{sidebar(false)}</aside>
    <header className="mobile-bar"><button className="icon-button" aria-label="Open menu" onClick={() => drawer.current?.showModal()}><Menu size={21} /></button><strong>My Day Desk</strong></header>
    <dialog className="drawer" ref={drawer} aria-label="Navigation" onClick={event => { if (event.target === event.currentTarget) drawer.current?.close() }}>
      <aside>{sidebar(true)}</aside>
    </dialog>
    <main className="content" id="main-content">
      <header className="page-header">
        <div><h1>{section.title}</h1><p>{section.description}</p></div>
        <button className="button primary" disabled={plans === null} onClick={() => setEditor('new')}><Plus size={18} /> Add {section.singular} plan</button>
      </header>
      {signOutError && <p className="error" role="alert">Sign-out failed. Please try again.</p>}
      <section className="panel" aria-labelledby="plan-heading">
        <div className="panel-header"><h2 id="plan-heading">{section.plural}</h2><p>{visiblePlans ? visiblePlans.length + (visiblePlans.length === 1 ? ' plan' : ' plans') : ''}</p></div>
        {loadError ? <p className="error" role="alert">Plans could not be loaded. Refresh the page to try again.</p>
          : !visiblePlans ? <p className="muted" role="status">Loading plans…</p>
          : visiblePlans.length === 0 ? <div className="empty"><span className="mark"><section.icon size={21} /></span><h3>No {section.singular} plans yet</h3><p>Use “Add {section.singular} plan” to write your first one.</p></div>
          : <div className="plan-list">{visiblePlans.map(plan => <details className="plan" key={plan.id}>
            <summary><strong>{plan.title}</strong>{plan.schedule && <span>{plan.schedule}</span>}<ChevronDown size={17} /></summary>
            <div className="plan-body"><h3>{section.details}</h3><p>{plan.details}</p>
              {plan.notes && <><h3>Notes</h3><p>{plan.notes}</p></>}
              <button className="button" onClick={() => setEditor(plan)}><Pencil size={15} />Edit plan</button></div>
          </details>)}</div>}
      </section>
    </main>
    {editor && <PlanEditor kind={kind} plan={editor === 'new' ? undefined : editor} close={() => setEditor(null)} save={save} />}
  </div>
}

function PlanEditor({ kind, plan, close, save }: { kind: Kind; plan?: Plan; close: () => void; save: (plan: Omit<Plan, 'id'>) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const section = sections[kind]
  useEffect(() => { dialog.current?.showModal() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const title = String(data.get('title')).trim()
    const details = String(data.get('details')).trim()
    if (!title || !details) {
      setError('Enter a title and plan details.')
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
      <label>Title<input name="title" maxLength={100} required autoFocus defaultValue={plan?.title} /></label>
      <label>Schedule <span className="muted">(optional)</span><input name="schedule" maxLength={100} placeholder={section.schedule} defaultValue={plan?.schedule} /></label>
      <label>{section.details}<textarea name="details" rows={5} maxLength={8000} required placeholder={section.example} defaultValue={plan?.details} /></label>
      <details className="optional" open={plan?.notes ? true : undefined}><summary>Notes <span className="muted">(optional)</span></summary><textarea aria-label="Notes" name="notes" rows={3} maxLength={4000} defaultValue={plan?.notes} /></details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="editor-actions"><button className="button" type="button" disabled={saving} onClick={close}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save plan'}</button></div>
    </form>
  </dialog>
}

createRoot(document.getElementById('root')!).render(<App />)
