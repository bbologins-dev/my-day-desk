import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import type { Firestore } from 'firebase/firestore'
import { Pencil, Plus, Star, Trash2, X } from 'lucide-react'

type Website = { id: string; name: string; url: string; description: string; usefulness: string; tags: string; favourite: boolean; removed: boolean }
const defaults: Website[] = [
  { id: 'freegym', name: 'FreeGym', url: 'https://freegym.ai/', description: 'Fitness community with sections on training, nutrition, recovery and science, and links to 3D anatomy tools.', usefulness: 'Explore fitness topics and find ideas to review when planning workouts.', tags: 'Learning, Community', favourite: false, removed: false },
  { id: 'kovo', name: 'Kovo Fitness', url: 'https://www.kovofitness.com/exercises', description: 'Exercise reference used for the Kovo demonstration links in your workout plans.', usefulness: 'Look up exercise demonstrations while writing or reviewing your routines.', tags: 'Exercises, Demonstrations', favourite: false, removed: false },
  { id: 'exsercise', name: 'Exsercise', url: 'https://www.exsercise.com/equipment/bodyweight', description: 'Exercise reference used for the Exsercise demonstration links in your workout plans.', usefulness: 'Find another reference for exercise technique and bodyweight movements.', tags: 'Exercises, Bodyweight', favourite: false, removed: false },
]

export function FitnessLibrary({ db, uid }: { db: Firestore; uid: string }) {
  const [records, setRecords] = useState<Website[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Website | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [removed, setRemoved] = useState<Website | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => onSnapshot(collection(db, 'users', uid, 'fitnessLibrary'), snapshot => {
    setRecords(snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as Website))
    setError('')
  }, () => setError('The library could not be loaded. Refresh to try again.')), [db, uid])
  useEffect(() => { if (editor) dialog.current?.showModal() }, [editor])
  const merged = new Map(defaults.map(item => [item.id, item]))
  records?.forEach(item => merged.set(item.id, item))
  const websites = [...merged.values()].filter(item => !item.removed && `${item.name} ${item.description} ${item.usefulness} ${item.tags}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name))
  async function write(item: Website) {
    const { id, ...data } = item
    await setDoc(doc(db, 'users', uid, 'fitnessLibrary', id), { ...data, updatedAt: serverTimestamp() })
  }
  async function change(item: Website, action: 'favourite' | 'remove' | 'restore') {
    setBusy(true)
    try {
      await write({ ...item, favourite: action === 'favourite' ? !item.favourite : item.favourite, removed: action === 'remove' })
      if (action === 'remove') setRemoved(item)
      if (action === 'restore') setRemoved(null)
      setError('')
    } catch { setError('Changes could not be saved. Please try again.') }
    finally { setBusy(false) }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const url = String(data.get('url')).trim()
    try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error() }
    catch { setError('Enter a valid website address starting with https:// or http://.'); return }
    setBusy(true)
    const previous = typeof editor === 'object' && editor ? editor : null
    try {
      await write({ id: previous?.id ?? doc(collection(db, 'users', uid, 'fitnessLibrary')).id,
        name: String(data.get('name')).trim(), url, description: String(data.get('description')).trim(),
        usefulness: String(data.get('usefulness')).trim(), tags: String(data.get('tags')).trim(),
        favourite: previous?.favourite ?? false, removed: false })
      setEditor(null); setError('')
    } catch { setError('The website could not be saved. Your edits are still here.') }
    finally { setBusy(false) }
  }
  const editing = typeof editor === 'object' ? editor : null
  return <section className="panel" aria-labelledby="library-heading">
    <div className="panel-header"><div><h2 id="library-heading">Fitness Library</h2><p>Your private collection of useful fitness websites.</p></div>
      <button className="button primary" disabled={!records} onClick={() => { setError(''); setEditor('new') }}><Plus size={16} />Add website</button></div>
    <label className="library-search">Search websites<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search names, descriptions or tags" /></label>
    {error && !editor && <p className="error" role="alert">{error}</p>}
    {removed && <p className="library-notice" role="status">{removed.name} removed. <button className="button" disabled={busy} onClick={() => void change(removed, 'restore')}>Undo</button></p>}
    {!records ? <p role="status">Loading library…</p> : <div className="library-grid">
      {websites.map(item => <article className="library-card" key={item.id}>
        <div className="panel-header"><h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a></h3>
          <button className="icon-button" aria-label={`${item.favourite ? 'Unfavourite' : 'Favourite'} ${item.name}`} aria-pressed={item.favourite} disabled={busy} onClick={() => void change(item, 'favourite')}><Star size={17} fill={item.favourite ? 'currentColor' : 'none'} /></button></div>
        <p>{item.description}</p><p><strong>Useful for:</strong> {item.usefulness}</p>
        <div className="library-tags">{item.tags.split(',').map(tag => tag.trim()).filter(Boolean).map((tag, index) => <span key={index}>{tag}</span>)}</div>
        <div className="library-actions"><button className="button" onClick={() => { setError(''); setEditor(item) }}><Pencil size={14} />Edit</button>
          <button className="icon-button" disabled={busy} aria-label={`Remove ${item.name}`} onClick={() => void change(item, 'remove')}><Trash2 size={16} /></button></div>
      </article>)}
      {!websites.length && <p className="muted">No websites found. Add a website or try another search.</p>}
    </div>}
    {editor && <dialog className="editor" ref={dialog} aria-labelledby="website-title" onCancel={event => { event.preventDefault(); if (!busy) setEditor(null) }}>
      <form onSubmit={event => void submit(event)}>
        <div className="editor-header"><h2 id="website-title">{editing ? 'Edit website' : 'Add website'}</h2><button className="icon-button" type="button" aria-label="Close website editor" disabled={busy} onClick={() => setEditor(null)}><X size={18} /></button></div>
        <label>Name<input name="name" required maxLength={100} defaultValue={editing?.name} autoFocus /></label>
        <label>Website URL<input name="url" type="url" required maxLength={2000} placeholder="https://" defaultValue={editing?.url} /></label>
        <label>What it offers<textarea name="description" required maxLength={2000} rows={3} defaultValue={editing?.description} /></label>
        <label>Why it is useful to me<textarea name="usefulness" required maxLength={2000} rows={2} defaultValue={editing?.usefulness} /></label>
        <label>Tags (separate with commas)<input name="tags" maxLength={300} defaultValue={editing?.tags} placeholder="Exercises, Learning" /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="editor-actions"><button className="button" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save website'}</button></div>
      </form>
    </dialog>}
  </section>
}
