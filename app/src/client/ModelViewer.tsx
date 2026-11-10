import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/** Orbit / pan / zoom viewer for the project's .glb, with the model's scenes (cameras) as buttons. */
export default function ModelViewer({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ fit: () => void; go: (i: number) => void } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pct, setPct] = useState(0)
  const [views, setViews] = useState<string[]>([])

  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8577, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(5, 10, 7); scene.add(sun)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    let cams: THREE.PerspectiveCamera[] = []
    let raf = 0, alive = true
    const size = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
    const ro = new ResizeObserver(size); ro.observe(el); size()
    const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop) }

    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(url, (g) => {
      if (!alive) return
      // SketchUp exports are Z-up in some exporters; glTF is Y-up — trust the file
      scene.add(g.scene)
      const box = new THREE.Box3().setFromObject(g.scene)
      const c = box.getCenter(new THREE.Vector3()); const r = box.getSize(new THREE.Vector3()).length() / 2 || 1
      const fit = () => {
        controls.target.copy(c)
        camera.position.copy(c).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(r * 2.2))
        camera.near = r / 500; camera.far = r * 50; camera.fov = 45; camera.updateProjectionMatrix()
      }
      cams = g.cameras.filter((x): x is THREE.PerspectiveCamera => (x as THREE.PerspectiveCamera).isPerspectiveCamera)
      const go = (i: number) => {
        const v = cams[i]; if (!v) return
        v.updateMatrixWorld()
        const p = new THREE.Vector3(), q = new THREE.Quaternion()
        v.matrixWorld.decompose(p, q, new THREE.Vector3())
        camera.position.copy(p); camera.fov = v.fov; camera.updateProjectionMatrix()
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
        controls.target.copy(p).add(dir.multiplyScalar(Math.max(r * 0.3, p.distanceTo(c) * 0.5)))
      }
      api.current = { fit, go }
      setViews(cams.map((x, i) => (x.name || x.parent?.name || `View ${i + 1}`).replace(/_/g, ' ')))
      fit(); setState('ready'); loop()
    }, (e) => { if (e.total) setPct(e.loaded / e.total) }, () => alive && setState('error'))

    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { Object.values(x).forEach((v) => (v as THREE.Texture)?.isTexture && (v as THREE.Texture).dispose()); x.dispose() }) } })
      renderer.dispose(); el.removeChild(renderer.domElement)
    }
  }, [url])

  return (
    <div className="mv">
      <div ref={host} className="mv-canvas" />
      {state === 'loading' && <div className="mv-msg">Loading model… {pct ? `${Math.round(pct * 100)}%` : ''}</div>}
      {state === 'error' && <div className="mv-msg">The model couldn’t be displayed. Use Download instead.</div>}
      {state === 'ready' && <div className="mv-bar">
        <button type="button" onClick={() => api.current?.fit()}>Overview</button>
        {views.map((v, i) => <button key={i} type="button" onClick={() => api.current?.go(i)}>{v}</button>)}
        <span className="mv-hint">Drag to orbit · right-drag to pan · scroll to zoom</span>
      </div>}
    </div>
  )
}
