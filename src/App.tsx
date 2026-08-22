import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileCheck2,
  FileText,
  Grip,
  GripVertical,
  ListPlus,
  LockKeyhole,
  Minus,
  Move,
  Pencil,
  PenLine,
  Plus,
  RotateCcw,
  ShieldCheck,
  SquareCheckBig,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument, StandardFonts, rgb, type PDFImage } from 'pdf-lib'

GlobalWorkerOptions.workerSrc = workerUrl

type Size = { width: number; height: number }

type StoredSignature = {
  dataUrl: string
  pixelWidth: number
  pixelHeight: number
}

type SignaturePlacement = StoredSignature & {
  id: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

type TextColor = '#1c211f' | '#193f7a' | '#594334'

type FormPlacement = {
  id: string
  kind: 'text' | 'mark'
  mark?: 'check' | 'x'
  text: string
  color: TextColor
  fontSize: number
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}

type TextEditorValue = {
  text: string
  color: TextColor
  fontSize: number
}

type FillDraft = TextEditorValue & {
  id: string
}

type StrokePoint = { x: number; y: number }
type Stroke = {
  points: StrokePoint[]
  color: string
  width: number
}

const MAX_FILE_SIZE = 50 * 1024 * 1024
const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5]
const MARK_GEOMETRY = {
  inset: 0.2,
  strokeRatio: 0.065,
  check: {
    start: { x: 0.2, y: 0.52 },
    middle: { x: 0.42, y: 0.76 },
    end: { x: 0.82, y: 0.24 },
  },
} as const

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function safeOutputName(name: string) {
  const base = name.replace(/\.pdf$/i, '').trim() || 'documento'
  return `${base}-finalizado.pdf`
}

function pdfColor(hex: TextColor) {
  const value = hex.slice(1)
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  )
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function LogoMark() {
  return (
    <div className="logo-mark" aria-hidden="true">
      <svg viewBox="0 0 42 42" fill="none">
        <path d="M7 28.5C13 17.5 19 11.5 29.5 7" />
        <path d="M10 32.5c8.7-1.6 15.8-1.8 22-.5" />
        <path d="M27.5 8.5 33 14l-5.2 1.3-1.6-1.6 1.3-5.2Z" />
      </svg>
    </div>
  )
}

function FormMarkShape({ mark }: { mark: 'check' | 'x' }) {
  const inset = MARK_GEOMETRY.inset * 100
  const farEdge = (1 - MARK_GEOMETRY.inset) * 100
  const check = MARK_GEOMETRY.check
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
      {mark === 'x' ? (
        <>
          <path d={`M ${inset} ${inset} L ${farEdge} ${farEdge}`} />
          <path d={`M ${inset} ${farEdge} L ${farEdge} ${inset}`} />
        </>
      ) : (
        <path d={`M ${check.start.x * 100} ${check.start.y * 100} L ${check.middle.x * 100} ${check.middle.y * 100} L ${check.end.x * 100} ${check.end.y * 100}`} />
      )}
    </svg>
  )
}

function EmptyState({ onPick }: { onPick: (file: File) => void }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file?: File) => {
    if (file) onPick(file)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    handleFile(event.dataTransfer.files[0])
  }

  return (
    <section className="empty-state">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={14} /> Simples por intenção</div>
        <h1>Sua assinatura.<br /><em>No lugar certo.</em></h1>
        <p>
          Preencha campos, assine com o próprio traço e baixe o PDF pronto —
          sem cadastro, sem complicação.
        </p>
        <div className="trust-row">
          <span><ShieldCheck size={17} /> Tudo fica no seu navegador</span>
          <span><PenLine size={17} /> Funciona com mouse ou toque</span>
        </div>
      </div>

      <div className="upload-composition">
        <div className="paper-shadow paper-shadow-one" />
        <div className="paper-shadow paper-shadow-two" />
        <div
          className={`drop-zone ${isDragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false)
          }}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => handleFile(event.target.files?.[0])}
            hidden
          />
          <div className="upload-icon"><Upload size={28} strokeWidth={1.7} /></div>
          <h2>Comece com um PDF</h2>
          <p>Arraste o arquivo para cá ou escolha no seu dispositivo</p>
          <button className="button primary" type="button">
            Escolher PDF <ArrowRight size={17} />
          </button>
          <small>PDF de até 50 MB</small>
        </div>
      </div>
    </section>
  )
}

function PdfCanvas({
  document,
  pageNumber,
  zoom,
  onSize,
  onDropDraft,
  children,
}: {
  document: PDFDocumentProxy
  pageNumber: number
  zoom: number
  onSize: (size: Size) => void
  onDropDraft: (draftId: string, x: number, y: number) => void
  children: React.ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [rendering, setRendering] = useState(true)
  const [draftOver, setDraftOver] = useState(false)

  useEffect(() => {
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<typeof document.getPage>>['render']> | null = null

    const render = async () => {
      setRendering(true)
      const page = await document.getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale: 1.65 })
      const nextSize = { width: viewport.width, height: viewport.height }
      setSize(nextSize)
      onSize(nextSize)
      const canvas = canvasRef.current
      if (!canvas) return
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      await renderTask.promise
      if (!cancelled) setRendering(false)
    }

    void render().catch((error) => {
      if (error?.name !== 'RenderingCancelledException') setRendering(false)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, onSize])

  const width = size ? size.width * zoom : 850

  return (
    <div
      className={`pdf-page ${rendering ? 'is-rendering' : ''} ${draftOver ? 'is-draft-over' : ''}`}
      style={{
        width,
        maxWidth: zoom <= 1 ? '100%' : 'none',
        aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1.414',
      }}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('application/x-traco-fill')) {
          event.preventDefault()
          setDraftOver(true)
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-traco-fill')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraftOver(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDraftOver(false)
        const draftId = event.dataTransfer.getData('application/x-traco-fill')
        if (!draftId) return
        const rect = event.currentTarget.getBoundingClientRect()
        onDropDraft(
          draftId,
          Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
          Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        )
      }}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      {rendering && <div className="page-loader"><span /></div>}
      {draftOver && <div className="draft-drop-indicator"><Move size={18} /> Solte para posicionar</div>}
      {!rendering && children}
    </div>
  )
}

function SignatureOverlay({
  placement,
  selected,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
}: {
  placement: SignaturePlacement
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<SignaturePlacement>) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const operation = useRef<null | {
    type: 'move' | 'resize'
    pointerId: number
    startClientX: number
    startClientY: number
    rectWidth: number
    rectHeight: number
    start: SignaturePlacement
  }>(null)

  const startOperation = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    type: 'move' | 'resize',
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const page = (event.currentTarget as HTMLElement).closest('.pdf-page')
    if (!page) return
    const rect = page.getBoundingClientRect()
    operation.current = {
      type,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      rectWidth: rect.width,
      rectHeight: rect.height,
      start: { ...placement },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect()
  }

  const moveOperation = (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    const active = operation.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = (event.clientX - active.startClientX) / active.rectWidth
    const dy = (event.clientY - active.startClientY) / active.rectHeight

    if (active.type === 'move') {
      onChange({
        x: Math.min(1 - active.start.width, Math.max(0, active.start.x + dx)),
        y: Math.min(1 - active.start.height, Math.max(0, active.start.y + dy)),
      })
      return
    }

    const widthFromPointer = Math.max(0.08, active.start.width + dx)
    const maxWidthByX = 1 - active.start.x
    const maxScaleByY = (1 - active.start.y) / active.start.height
    const maxWidthByY = active.start.width * maxScaleByY
    const nextWidth = Math.min(0.72, maxWidthByX, maxWidthByY, widthFromPointer)
    const scale = nextWidth / active.start.width
    onChange({ width: nextWidth, height: active.start.height * scale })
  }

  const endOperation = (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    if (operation.current?.pointerId === event.pointerId) operation.current = null
  }

  return (
    <div
      className={`signature-placement ${selected ? 'is-selected' : ''}`}
      style={{
        left: `${placement.x * 100}%`,
        top: `${placement.y * 100}%`,
        width: `${placement.width * 100}%`,
        height: `${placement.height * 100}%`,
      }}
      onPointerDown={(event) => startOperation(event, 'move')}
      onPointerMove={moveOperation}
      onPointerUp={endOperation}
      onPointerCancel={endOperation}
      onClick={(event) => event.stopPropagation()}
      role="button"
      tabIndex={0}
      aria-label="Assinatura posicionada. Arraste para mover."
    >
      <img src={placement.dataUrl} alt="Sua assinatura" draggable={false} />
      {selected && (
        <>
          <div className="placement-label"><Grip size={12} /> arraste</div>
          <button
            className="placement-duplicate"
            type="button"
            title="Duplicar assinatura"
            aria-label="Duplicar assinatura"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onDuplicate() }}
          >
            <Copy size={13} />
          </button>
          <button
            className="placement-delete"
            type="button"
            title="Remover assinatura"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onDelete() }}
          >
            <Trash2 size={14} />
          </button>
          <button
            className="resize-handle"
            type="button"
            aria-label="Redimensionar assinatura"
            onPointerDown={(event) => startOperation(event, 'resize')}
            onPointerMove={moveOperation}
            onPointerUp={endOperation}
            onPointerCancel={endOperation}
          />
        </>
      )}
    </div>
  )
}

function FormOverlay({
  placement,
  selected,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
  onEdit,
}: {
  placement: FormPlacement
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<FormPlacement>) => void
  onDuplicate: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  const operation = useRef<null | {
    type: 'move' | 'resize'
    pointerId: number
    startClientX: number
    startClientY: number
    rectWidth: number
    rectHeight: number
    start: FormPlacement
  }>(null)

  const startOperation = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    type: 'move' | 'resize',
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const page = (event.currentTarget as HTMLElement).closest('.pdf-page')
    if (!page) return
    const rect = page.getBoundingClientRect()
    operation.current = {
      type,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      rectWidth: rect.width,
      rectHeight: rect.height,
      start: { ...placement },
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect()
  }

  const moveOperation = (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    const active = operation.current
    if (!active || active.pointerId !== event.pointerId) return
    const dx = (event.clientX - active.startClientX) / active.rectWidth
    const dy = (event.clientY - active.startClientY) / active.rectHeight

    if (active.type === 'move') {
      onChange({
        x: Math.min(1 - active.start.width, Math.max(0, active.start.x + dx)),
        y: Math.min(1 - active.start.height, Math.max(0, active.start.y + dy)),
      })
      return
    }

    const minWidth = active.start.kind === 'mark' ? 0.018 : 0.1
    const maxWidth = active.start.kind === 'mark' ? 0.18 : 0.82
    const nextWidth = Math.min(
      maxWidth,
      1 - active.start.x,
      Math.max(minWidth, active.start.width + dx),
    )
    const scale = nextWidth / active.start.width
    const nextHeight = Math.min(1 - active.start.y, active.start.height * scale)
    onChange({
      width: nextWidth,
      height: nextHeight,
      fontSize: active.start.kind === 'text'
        ? Math.min(0.05, Math.max(0.009, active.start.fontSize * scale))
        : active.start.fontSize,
    })
  }

  const endOperation = (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>) => {
    if (operation.current?.pointerId === event.pointerId) operation.current = null
  }

  return (
    <div
      className={`form-placement ${placement.kind === 'mark' ? 'is-mark' : 'is-text'} ${selected ? 'is-selected' : ''}`}
      style={{
        left: `${placement.x * 100}%`,
        top: `${placement.y * 100}%`,
        width: `${placement.width * 100}%`,
        height: `${placement.height * 100}%`,
        color: placement.color,
        '--form-font-size': `${placement.fontSize * 100}cqh`,
      } as React.CSSProperties}
      onPointerDown={(event) => startOperation(event, 'move')}
      onPointerMove={moveOperation}
      onPointerUp={endOperation}
      onPointerCancel={endOperation}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (placement.kind === 'text') onEdit()
      }}
      onClick={(event) => event.stopPropagation()}
      role="button"
      tabIndex={0}
      aria-label={placement.kind === 'text'
        ? `Texto do formulário: ${placement.text}. Arraste para mover.`
        : `Marcação ${placement.mark === 'check' ? 'de seleção' : 'X'}. Arraste para mover.`}
    >
      {placement.kind === 'text'
        ? <span className="form-text-value">{placement.text}</span>
        : <span className="form-mark-value"><FormMarkShape mark={placement.mark ?? 'x'} /></span>}
      {selected && (
        <>
          <div className="placement-label"><Grip size={12} /> arraste</div>
          {placement.kind === 'text' && (
            <button
              className="placement-edit"
              type="button"
              title="Editar texto"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); onEdit() }}
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            className="placement-duplicate"
            type="button"
            title="Duplicar item"
            aria-label="Duplicar item"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onDuplicate() }}
          >
            <Copy size={13} />
          </button>
          <button
            className="placement-delete"
            type="button"
            title="Remover item"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onDelete() }}
          >
            <Trash2 size={14} />
          </button>
          <button
            className="resize-handle"
            type="button"
            aria-label="Redimensionar item"
            onPointerDown={(event) => startOperation(event, 'resize')}
            onPointerMove={moveOperation}
            onPointerUp={endOperation}
            onPointerCancel={endOperation}
          />
        </>
      )}
    </div>
  )
}

function TextEditorModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: TextEditorValue
  onClose: () => void
  onSave: (value: TextEditorValue) => void
}) {
  const [text, setText] = useState(initial?.text ?? '')
  const [color, setColor] = useState<TextColor>(initial?.color ?? '#1c211f')
  const [fontSize, setFontSize] = useState(initial?.fontSize ?? 0.018)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && text.trim()) {
        event.preventDefault()
        onSave({ text: text.trim(), color, fontSize })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [color, fontSize, onClose, onSave, text])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="signature-modal text-editor-modal" role="dialog" aria-modal="true" aria-labelledby="text-editor-title">
        <header className="modal-header">
          <div>
            <div className="eyebrow"><Type size={14} /> preencher formulário</div>
            <h2 id="text-editor-title">{initial ? 'Edite o texto' : 'Digite no documento'}</h2>
            <p>Depois você poderá mover e redimensionar o texto diretamente na página.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <label className="form-input-label" htmlFor="form-text-input">Texto do campo</label>
        <textarea
          id="form-text-input"
          autoFocus
          value={text}
          maxLength={240}
          rows={4}
          placeholder="Ex.: Maria da Silva"
          onChange={(event) => setText(event.target.value)}
        />
        <div className="character-count">{text.length} / 240</div>

        <div className="text-editor-options">
          <div className="control-group">
            <span>Cor</span>
            <div className="swatches">
              {[
                ['#1c211f', 'Preto'],
                ['#193f7a', 'Azul'],
                ['#594334', 'Sépia'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`swatch ${color === value ? 'active' : ''}`}
                  style={{ '--swatch': value } as React.CSSProperties}
                  onClick={() => setColor(value as TextColor)}
                  aria-label={label}
                  title={label}
                >{color === value && <Check size={12} />}</button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span>Tamanho</span>
            <div className="text-size-options">
              {[
                [0.014, 'P'],
                [0.018, 'M'],
                [0.024, 'G'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={fontSize === value ? 'active' : ''}
                  onClick={() => setFontSize(value as number)}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        <footer className="modal-footer text-editor-footer">
          <span><Pencil size={14} /> Dê dois cliques no texto para editar novamente</span>
          <div>
            <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="button primary"
              disabled={!text.trim()}
              onClick={() => onSave({ text: text.trim(), color, fontSize })}
            >
              {initial ? 'Salvar alterações' : 'Adicionar à página'} <ArrowRight size={17} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function BatchFillModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (values: TextEditorValue[]) => void
}) {
  const [rawText, setRawText] = useState('')
  const [color, setColor] = useState<TextColor>('#1c211f')
  const [fontSize, setFontSize] = useState(0.018)
  const values = useMemo(
    () => rawText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 20),
    [rawText],
  )

  const save = useCallback(() => {
    if (!values.length) return
    onSave(values.map((text) => ({ text, color, fontSize })))
  }, [color, fontSize, onSave, values])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && values.length) {
        event.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, save, values.length])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="signature-modal text-editor-modal batch-fill-modal" role="dialog" aria-modal="true" aria-labelledby="batch-fill-title">
        <header className="modal-header">
          <div>
            <div className="eyebrow"><ListPlus size={14} /> preenchimento rápido</div>
            <h2 id="batch-fill-title">Prepare todos os dados</h2>
            <p>Digite ou cole um preenchimento por linha. Eles ficarão prontos para arrastar.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <label className="form-input-label" htmlFor="batch-fill-input">Um dado por linha</label>
        <textarea
          id="batch-fill-input"
          autoFocus
          value={rawText}
          maxLength={2000}
          rows={7}
          placeholder={'Maria da Silva\n123.456.789-00\nSão Paulo\n(11) 99999-9999'}
          onChange={(event) => setRawText(event.target.value)}
        />
        <div className="batch-count">
          <span>{values.length ? `${values.length} ${values.length === 1 ? 'preenchimento pronto' : 'preenchimentos prontos'}` : 'Digite o primeiro dado'}</span>
          <small>máximo de 20</small>
        </div>

        <div className="text-editor-options">
          <div className="control-group">
            <span>Cor</span>
            <div className="swatches">
              {[
                ['#1c211f', 'Preto'],
                ['#193f7a', 'Azul'],
                ['#594334', 'Sépia'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`swatch ${color === value ? 'active' : ''}`}
                  style={{ '--swatch': value } as React.CSSProperties}
                  onClick={() => setColor(value as TextColor)}
                  aria-label={label}
                  title={label}
                >{color === value && <Check size={12} />}</button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span>Tamanho</span>
            <div className="text-size-options">
              {[
                [0.014, 'P'],
                [0.018, 'M'],
                [0.024, 'G'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={fontSize === value ? 'active' : ''}
                  onClick={() => setFontSize(value as number)}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        <footer className="modal-footer text-editor-footer">
          <span><GripVertical size={14} /> Depois, arraste cada ficha até o campo correspondente</span>
          <div>
            <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
            <button type="button" className="button primary" disabled={!values.length} onClick={save}>
              Adicionar {values.length || ''} à bandeja <ArrowRight size={17} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function FillTray({
  drafts,
  className = '',
  onPlace,
  onDrop,
  onRemove,
  onAddMany,
}: {
  drafts: FillDraft[]
  className?: string
  onPlace: (id: string) => void
  onDrop: (id: string, x: number, y: number) => void
  onRemove: (id: string) => void
  onAddMany: () => void
}) {
  const gesture = useRef<null | {
    id: string
    text: string
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  }>(null)
  const hoveredPage = useRef<HTMLElement | null>(null)
  const suppressClick = useRef(false)
  const [dragPreview, setDragPreview] = useState<{ text: string; x: number; y: number } | null>(null)

  const clearGesture = () => {
    hoveredPage.current?.classList.remove('is-pointer-draft-over')
    hoveredPage.current = null
    gesture.current = null
    setDragPreview(null)
  }

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const active = gesture.current
      if (!active || active.pointerId !== event.pointerId) return
      const distance = Math.hypot(event.clientX - active.startX, event.clientY - active.startY)
      if (!active.moved && distance < 6) return

      active.moved = true
      suppressClick.current = true
      setDragPreview({ text: active.text, x: event.clientX + 13, y: event.clientY + 13 })
      const element = window.document.elementFromPoint(event.clientX, event.clientY)
      const page = element?.closest('.pdf-page') as HTMLElement | null
      if (page !== hoveredPage.current) {
        hoveredPage.current?.classList.remove('is-pointer-draft-over')
        page?.classList.add('is-pointer-draft-over')
        hoveredPage.current = page
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const active = gesture.current
      if (!active || active.pointerId !== event.pointerId) return
      const page = (window.document.elementFromPoint(event.clientX, event.clientY)?.closest('.pdf-page')
        ?? hoveredPage.current) as HTMLElement | null
      if (active.moved && page) {
        const rect = page.getBoundingClientRect()
        onDrop(
          active.id,
          Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
          Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
        )
      }
      clearGesture()
    }

    const handlePointerCancel = () => clearGesture()
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }, [onDrop])

  if (!drafts.length) return null

  return (
    <section className={`fill-tray ${className ?? ''}`} aria-label="Bandeja de preenchimentos">
      <header>
        <div><strong>Bandeja</strong><span>{drafts.length} {drafts.length === 1 ? 'dado pronto' : 'dados prontos'}</span></div>
        <button type="button" onClick={onAddMany} title="Adicionar mais preenchimentos" aria-label="Adicionar mais preenchimentos"><Plus size={14} /></button>
      </header>
      <div className="fill-tray-list" role="list">
        {drafts.map((draft) => (
          <div
            className="fill-draft-chip"
            key={draft.id}
            role="listitem"
          >
            <button
              className="fill-draft-main"
              type="button"
              onPointerDown={(event) => {
                if (event.button !== 0) return
                suppressClick.current = false
                gesture.current = {
                  id: draft.id,
                  text: draft.text,
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  moved: false,
                }
              }}
              onClick={(event) => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  event.preventDefault()
                  return
                }
                onPlace(draft.id)
              }}
              title="Clique para colocar ou arraste até o PDF"
            >
              <GripVertical size={14} />
              <span>{draft.text}</span>
            </button>
            <button className="fill-draft-remove" type="button" onClick={() => onRemove(draft.id)} aria-label={`Remover ${draft.text}`}><X size={12} /></button>
          </div>
        ))}
      </div>
      <small><Move size={11} /> Arraste para o PDF ou toque para colocar</small>
      {dragPreview && <div className="fill-drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }}><GripVertical size={13} />{dragPreview.text}</div>}
    </section>
  )
}

function SignaturePad({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (signature: StoredSignature) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const activeStroke = useRef<Stroke | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [color, setColor] = useState('#193f7a')
  const [penWidth, setPenWidth] = useState(8)

  const drawStroke = useCallback((context: CanvasRenderingContext2D, stroke: Stroke) => {
    if (!stroke.points.length) return
    context.strokeStyle = stroke.color
    context.fillStyle = stroke.color
    context.lineWidth = stroke.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    if (stroke.points.length === 1) {
      context.beginPath()
      context.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2)
      context.fill()
      return
    }
    context.beginPath()
    context.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let index = 1; index < stroke.points.length; index += 1) {
      const point = stroke.points[index]
      const previous = stroke.points[index - 1]
      const middleX = (previous.x + point.x) / 2
      const middleY = (previous.y + point.y) / 2
      context.quadraticCurveTo(previous.x, previous.y, middleX, middleY)
    }
    const last = stroke.points[stroke.points.length - 1]
    context.lineTo(last.x, last.y)
    context.stroke()
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach((stroke) => drawStroke(context, stroke))
  }, [drawStroke, strokes])

  useEffect(() => redraw(), [redraw])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setStrokes((current) => current.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const stroke = { points: [pointFromEvent(event)], color, width: penWidth }
    activeStroke.current = stroke
    const context = event.currentTarget.getContext('2d')
    if (context) drawStroke(context, stroke)
  }

  const moveStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStroke.current
    const context = event.currentTarget.getContext('2d')
    if (!stroke || !context) return
    const previous = stroke.points[stroke.points.length - 1]
    const point = pointFromEvent(event)
    stroke.points.push(point)
    context.strokeStyle = stroke.color
    context.lineWidth = stroke.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(previous.x, previous.y)
    context.lineTo(point.x, point.y)
    context.stroke()
  }

  const finishStroke = () => {
    if (!activeStroke.current) return
    const finished = activeStroke.current
    activeStroke.current = null
    setStrokes((current) => [...current, finished])
  }

  const save = () => {
    const source = canvasRef.current
    if (!source || !strokes.length) return
    const context = source.getContext('2d')
    if (!context) return
    const pixels = context.getImageData(0, 0, source.width, source.height)
    let minX = source.width
    let minY = source.height
    let maxX = 0
    let maxY = 0

    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const alpha = pixels.data[(y * source.width + x) * 4 + 3]
        if (alpha > 0) {
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }

    const padding = 18
    const cropX = Math.max(0, minX - padding)
    const cropY = Math.max(0, minY - padding)
    const cropWidth = Math.min(source.width - cropX, maxX - minX + padding * 2)
    const cropHeight = Math.min(source.height - cropY, maxY - minY + padding * 2)
    const output = window.document.createElement('canvas')
    output.width = Math.max(1, cropWidth)
    output.height = Math.max(1, cropHeight)
    output.getContext('2d')?.drawImage(
      source,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    )
    onSave({
      dataUrl: output.toDataURL('image/png'),
      pixelWidth: output.width,
      pixelHeight: output.height,
    })
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-title">
        <header className="modal-header">
          <div>
            <div className="eyebrow"><PenLine size={14} /> assinatura manuscrita</div>
            <h2 id="signature-title">Desenhe o seu traço</h2>
            <p>Use o mouse, trackpad ou o dedo. O fundo será transparente no PDF.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <div className="signature-sheet">
          <span className="baseline-label">assine aqui</span>
          <canvas
            ref={canvasRef}
            width={960}
            height={320}
            onPointerDown={startStroke}
            onPointerMove={moveStroke}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            aria-label="Área para desenhar a assinatura"
          />
          <div className="signature-baseline" />
        </div>

        <div className="pad-controls">
          <div className="control-group">
            <span>Cor da tinta</span>
            <div className="swatches">
              {[
                ['#193f7a', 'Azul'],
                ['#171b22', 'Preto'],
                ['#594334', 'Sépia'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`swatch ${color === value ? 'active' : ''}`}
                  style={{ '--swatch': value } as React.CSSProperties}
                  onClick={() => setColor(value)}
                  aria-label={label}
                  title={label}
                >{color === value && <Check size={12} />}</button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <span>Espessura</span>
            <div className="pen-widths">
              {[6, 9, 13].map((width) => (
                <button
                  key={width}
                  type="button"
                  className={penWidth === width ? 'active' : ''}
                  onClick={() => setPenWidth(width)}
                  aria-label={`Traço ${width === 6 ? 'fino' : width === 9 ? 'médio' : 'grosso'}`}
                ><i style={{ height: Math.max(2, width / 3) }} /></button>
              ))}
            </div>
          </div>
          <div className="pad-history">
            <button type="button" className="text-button" onClick={() => setStrokes((current) => current.slice(0, -1))} disabled={!strokes.length}>
              <RotateCcw size={15} /> Desfazer
            </button>
            <button type="button" className="text-button danger" onClick={() => setStrokes([])} disabled={!strokes.length}>
              <Trash2 size={15} /> Limpar
            </button>
          </div>
        </div>

        <footer className="modal-footer">
          <span><LockKeyhole size={14} /> Sua assinatura não sai deste dispositivo</span>
          <div>
            <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
            <button type="button" className="button primary" onClick={save} disabled={!strokes.length}>
              Usar assinatura <ArrowRight size={17} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

export default function App() {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageSize, setPageSize] = useState<Size>({ width: 612, height: 792 })
  const [zoomIndex, setZoomIndex] = useState(1)
  const [placements, setPlacements] = useState<SignaturePlacement[]>([])
  const [formPlacements, setFormPlacements] = useState<FormPlacement[]>([])
  const [fillDrafts, setFillDrafts] = useState<FillDraft[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [storedSignature, setStoredSignature] = useState<StoredSignature | null>(null)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [textEditorId, setTextEditorId] = useState<string | 'new' | null>(null)
  const [batchFillOpen, setBatchFillOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const zoom = ZOOM_LEVELS[zoomIndex]
  const totalItems = placements.length + formPlacements.length
  const handlePageSize = useCallback((nextSize: Size) => setPageSize(nextSize), [])
  const currentPlacements = useMemo(
    () => placements.filter((placement) => placement.pageIndex === pageNumber - 1),
    [pageNumber, placements],
  )
  const currentFormPlacements = useMemo(
    () => formPlacements.filter((placement) => placement.pageIndex === pageNumber - 1),
    [formPlacements, pageNumber],
  )
  const textBeingEdited = textEditorId && textEditorId !== 'new'
    ? formPlacements.find((placement) => placement.id === textEditorId && placement.kind === 'text')
    : undefined

  const loadFile = useCallback(async (nextFile: File) => {
    setError(null)
    if (!nextFile.name.toLowerCase().endsWith('.pdf') && nextFile.type !== 'application/pdf') {
      setError('Escolha um arquivo no formato PDF.')
      return
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setError('Este PDF passa de 50 MB. Escolha um arquivo menor.')
      return
    }

    setLoading(true)
    try {
      const bytes = new Uint8Array(await nextFile.arrayBuffer())
      const task = getDocument({ data: bytes.slice() })
      const loaded = await task.promise
      setPdfDocument(loaded)
      setPdfBytes(bytes)
      setFile(nextFile)
      setPageNumber(1)
      setPlacements([])
      setFormPlacements([])
      setFillDrafts([])
      setSelectedId(null)
      setNotice('PDF carregado. Agora preencha os campos ou adicione sua assinatura.')
    } catch {
      setError('Não foi possível abrir este PDF. Ele pode estar protegido ou corrompido.')
    } finally {
      setLoading(false)
    }
  }, [])

  const resetDocument = useCallback(() => {
    setPdfDocument(null)
    setPdfBytes(null)
    setFile(null)
    setPlacements([])
    setFormPlacements([])
    setFillDrafts([])
    setSelectedId(null)
    setPageNumber(1)
    setError(null)
    setNotice(null)
  }, [])

  const addSignature = useCallback((signature: StoredSignature) => {
    const width = 0.27
    const pageRatio = pageSize.width / pageSize.height
    const signatureRatio = signature.pixelWidth / signature.pixelHeight
    const height = Math.min(0.16, (width / signatureRatio) * pageRatio)
    const placement: SignaturePlacement = {
      ...signature,
      id: crypto.randomUUID(),
      pageIndex: pageNumber - 1,
      width,
      height,
      x: (1 - width) / 2,
      y: Math.min(0.82, 0.68 - height / 2),
    }
    setPlacements((current) => [...current, placement])
    setSelectedId(placement.id)
    setNotice('Assinatura adicionada. Arraste para posicionar e use o canto para redimensionar.')
    window.setTimeout(() => {
      const stage = stageRef.current
      if (!stage) return
      stage.scrollTo({
        top: Math.max(0, placement.y * stage.scrollHeight - stage.clientHeight / 2),
        behavior: 'smooth',
      })
    }, 180)
  }, [pageNumber, pageSize])

  const onSignatureSaved = (signature: StoredSignature) => {
    setStoredSignature(signature)
    setSignatureOpen(false)
    addSignature(signature)
  }

  const chooseSignatureAction = () => {
    if (storedSignature) addSignature(storedSignature)
    else setSignatureOpen(true)
  }

  const updatePlacement = (id: string, patch: Partial<SignaturePlacement>) => {
    setPlacements((current) => current.map((placement) => (
      placement.id === id ? { ...placement, ...patch } : placement
    )))
  }

  const updateFormPlacement = (id: string, patch: Partial<FormPlacement>) => {
    setFormPlacements((current) => current.map((placement) => (
      placement.id === id ? { ...placement, ...patch } : placement
    )))
  }

  const revealPlacement = useCallback((y: number) => {
    window.setTimeout(() => {
      const stage = stageRef.current
      if (!stage) return
      stage.scrollTo({
        top: Math.max(0, y * stage.scrollHeight - stage.clientHeight / 2),
        behavior: 'smooth',
      })
    }, 180)
  }, [])

  const saveTextPlacement = useCallback((value: TextEditorValue) => {
    if (textEditorId && textEditorId !== 'new') {
      const lineCount = value.text.split(/\r?\n/).length
      setFormPlacements((current) => current.map((placement) => placement.id === textEditorId
        ? {
            ...placement,
            ...value,
            height: Math.max(placement.height, value.fontSize * 1.35 * lineCount),
          }
        : placement))
      setTextEditorId(null)
      setNotice('Texto atualizado no formulário.')
      return
    }

    const pageRatio = pageSize.width / pageSize.height
    const longestLine = Math.max(...value.text.split(/\r?\n/).map((line) => line.length), 1)
    const lineCount = value.text.split(/\r?\n/).length
    const width = Math.min(0.72, Math.max(0.22, longestLine * value.fontSize * 0.56 / pageRatio + 0.025))
    const height = Math.max(0.032, value.fontSize * 1.35 * lineCount)
    const offset = (formPlacements.filter((item) => item.pageIndex === pageNumber - 1).length % 5) * 0.025
    const placement: FormPlacement = {
      id: crypto.randomUUID(),
      kind: 'text',
      ...value,
      pageIndex: pageNumber - 1,
      x: Math.min(1 - width, (1 - width) / 2 + offset),
      y: Math.min(0.84, 0.38 + offset),
      width,
      height,
    }
    setFormPlacements((current) => [...current, placement])
    setSelectedId(placement.id)
    setTextEditorId(null)
    setNotice('Texto adicionado. Arraste até o campo correto.')
    revealPlacement(placement.y)
  }, [formPlacements, pageNumber, pageSize, revealPlacement, textEditorId])

  const addFillDrafts = useCallback((values: TextEditorValue[]) => {
    const drafts = values.map((value) => ({ ...value, id: crypto.randomUUID() }))
    setFillDrafts((current) => [...current, ...drafts])
    setBatchFillOpen(false)
    setNotice(`${drafts.length} ${drafts.length === 1 ? 'preenchimento preparado' : 'preenchimentos preparados'}. Arraste para os campos do PDF.`)
  }, [])

  const placeFillDraft = useCallback((id: string, dropX?: number, dropY?: number) => {
    const draft = fillDrafts.find((item) => item.id === id)
    if (!draft) return
    const pageRatio = pageSize.width / pageSize.height
    const longestLine = Math.max(...draft.text.split(/\r?\n/).map((line) => line.length), 1)
    const lineCount = draft.text.split(/\r?\n/).length
    const width = Math.min(0.72, Math.max(0.22, longestLine * draft.fontSize * 0.56 / pageRatio + 0.025))
    const height = Math.max(0.032, draft.fontSize * 1.35 * lineCount)
    const queuedIndex = formPlacements.filter((item) => item.pageIndex === pageNumber - 1).length % 5
    const fallbackOffset = queuedIndex * 0.025
    const x = dropX === undefined
      ? Math.min(1 - width, (1 - width) / 2 + fallbackOffset)
      : Math.min(1 - width, Math.max(0, dropX - width / 2))
    const y = dropY === undefined
      ? Math.min(1 - height, 0.38 + fallbackOffset)
      : Math.min(1 - height, Math.max(0, dropY - height / 2))
    const placement: FormPlacement = {
      ...draft,
      kind: 'text',
      pageIndex: pageNumber - 1,
      x,
      y,
      width,
      height,
    }
    setFormPlacements((current) => [...current, placement])
    setFillDrafts((current) => current.filter((item) => item.id !== id))
    setSelectedId(placement.id)
    setNotice('Preenchimento colocado. Ajuste a posição se precisar.')
    revealPlacement(placement.y)
  }, [fillDrafts, formPlacements, pageNumber, pageSize, revealPlacement])

  const addMark = useCallback((mark: 'check' | 'x') => {
    const width = 0.036
    const height = width * (pageSize.width / pageSize.height)
    const offset = (formPlacements.filter((item) => item.pageIndex === pageNumber - 1).length % 6) * 0.025
    const placement: FormPlacement = {
      id: crypto.randomUUID(),
      kind: 'mark',
      mark,
      text: '',
      color: '#1c211f',
      fontSize: 0.02,
      pageIndex: pageNumber - 1,
      x: Math.min(1 - width, 0.48 + offset),
      y: Math.min(1 - height, 0.4 + offset),
      width,
      height,
    }
    setFormPlacements((current) => [...current, placement])
    setSelectedId(placement.id)
    setNotice(mark === 'check'
      ? 'Marcação adicionada. Arraste até a opção desejada.'
      : 'X adicionado. Arraste até a opção desejada.')
    revealPlacement(placement.y)
  }, [formPlacements, pageNumber, pageSize, revealPlacement])

  const deleteItem = useCallback((id: string) => {
    setPlacements((current) => current.filter((placement) => placement.id !== id))
    setFormPlacements((current) => current.filter((placement) => placement.id !== id))
    setSelectedId((current) => current === id ? null : current)
  }, [])

  const duplicateItem = useCallback((id: string) => {
    const signature = placements.find((placement) => placement.id === id)
    if (signature) {
      const copy: SignaturePlacement = {
        ...signature,
        id: crypto.randomUUID(),
        x: signature.x + signature.width + 0.025 <= 1
          ? signature.x + 0.025
          : Math.max(0, signature.x - 0.025),
        y: signature.y + signature.height + 0.025 <= 1
          ? signature.y + 0.025
          : Math.max(0, signature.y - 0.025),
      }
      setPlacements((current) => [...current, copy])
      setSelectedId(copy.id)
      setNotice('Assinatura duplicada. Arraste a cópia para o novo local.')
      revealPlacement(copy.y)
      return
    }

    const formItem = formPlacements.find((placement) => placement.id === id)
    if (!formItem) return
    const copy: FormPlacement = {
      ...formItem,
      id: crypto.randomUUID(),
      x: formItem.x + formItem.width + 0.025 <= 1
        ? formItem.x + 0.025
        : Math.max(0, formItem.x - 0.025),
      y: formItem.y + formItem.height + 0.025 <= 1
        ? formItem.y + 0.025
        : Math.max(0, formItem.y - 0.025),
    }
    setFormPlacements((current) => [...current, copy])
    setSelectedId(copy.id)
    setNotice('Item duplicado. Arraste a cópia para o próximo campo.')
    revealPlacement(copy.y)
  }, [formPlacements, placements, revealPlacement])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (signatureOpen || textEditorId || batchFillOpen || !selectedId) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateItem(selectedId)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteItem(selectedId)
      }
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [batchFillOpen, deleteItem, duplicateItem, selectedId, signatureOpen, textEditorId])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const exportPdf = async () => {
    if (!pdfBytes || !file || !totalItems) return
    setExporting(true)
    setError(null)
    try {
      const outputDocument = await PDFDocument.load(pdfBytes.slice())
      const pages = outputDocument.getPages()
      const imageCache = new Map<string, PDFImage>()
      const formFont = await outputDocument.embedFont(StandardFonts.Helvetica)

      for (const placement of formPlacements) {
        const page = pages[placement.pageIndex]
        if (!page) continue
        const pageWidth = page.getWidth()
        const pageHeight = page.getHeight()
        const x = placement.x * pageWidth
        const top = pageHeight - placement.y * pageHeight
        const width = placement.width * pageWidth
        const height = placement.height * pageHeight
        const color = pdfColor(placement.color)

        if (placement.kind === 'text') {
          const lines = placement.text.split(/\r?\n/)
          let fontSize = placement.fontSize * pageHeight
          const widestLine = Math.max(...lines.map((line) => formFont.widthOfTextAtSize(line, fontSize)), 1)
          if (widestLine > width) fontSize *= width / widestLine
          const capHeight = formFont.heightAtSize(fontSize, { descender: false })
          const lineHeight = fontSize * 1.25
          lines.forEach((line, index) => {
            page.drawText(line, {
              x,
              y: top - capHeight - index * lineHeight,
              size: fontSize,
              font: formFont,
              color,
            })
          })
          continue
        }

        const right = x + width
        const bottom = top - height
        const insetX = width * MARK_GEOMETRY.inset
        const insetY = height * MARK_GEOMETRY.inset
        const thickness = Math.max(0.75, Math.min(width, height) * MARK_GEOMETRY.strokeRatio)
        if (placement.mark === 'x') {
          page.drawLine({
            start: { x: x + insetX, y: bottom + insetY },
            end: { x: right - insetX, y: top - insetY },
            thickness,
            color,
          })
          page.drawLine({
            start: { x: x + insetX, y: top - insetY },
            end: { x: right - insetX, y: bottom + insetY },
            thickness,
            color,
          })
        } else {
          const check = MARK_GEOMETRY.check
          page.drawLine({
            start: { x: x + width * check.start.x, y: top - height * check.start.y },
            end: { x: x + width * check.middle.x, y: top - height * check.middle.y },
            thickness,
            color,
          })
          page.drawLine({
            start: { x: x + width * check.middle.x, y: top - height * check.middle.y },
            end: { x: x + width * check.end.x, y: top - height * check.end.y },
            thickness,
            color,
          })
        }
      }

      for (const placement of placements) {
        const page = pages[placement.pageIndex]
        if (!page) continue
        let image = imageCache.get(placement.dataUrl)
        if (!image) {
          image = await outputDocument.embedPng(dataUrlToBytes(placement.dataUrl))
          imageCache.set(placement.dataUrl, image)
        }
        const pageWidth = page.getWidth()
        const pageHeight = page.getHeight()
        const width = placement.width * pageWidth
        const height = placement.height * pageHeight
        page.drawImage(image, {
          x: placement.x * pageWidth,
          y: pageHeight - placement.y * pageHeight - height,
          width,
          height,
        })
      }

      const saved = await outputDocument.save()
      const blob = new Blob([new Uint8Array(saved)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = safeOutputName(file.name)
      window.document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('PDF final baixado com sucesso.')
    } catch {
      setError('Não foi possível gerar o PDF final. Tente novamente.')
    } finally {
      setExporting(false)
    }
  }

  const changePage = (nextPage: number) => {
    if (!pdfDocument) return
    setPageNumber(Math.min(pdfDocument.numPages, Math.max(1, nextPage)))
    setSelectedId(null)
    window.requestAnimationFrame(() => stageRef.current?.scrollTo({ top: 0, left: 0 }))
  }

  const onHiddenInput = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0]
    if (next) void loadFile(next)
    event.target.value = ''
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={pdfDocument ? resetDocument : undefined}>
          <LogoMark />
          <span><strong>Traço</strong><small>editor de PDF</small></span>
        </button>
        <div className="topbar-actions">
          <div className="privacy-chip"><LockKeyhole size={14} /> Processamento local</div>
          {pdfDocument && (
            <button className="button ghost compact" type="button" onClick={() => inputRef.current?.click()}>
              <FileText size={16} /> Trocar PDF
            </button>
          )}
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={onHiddenInput} />
        </div>
      </header>

      {loading && (
        <div className="loading-screen">
          <LogoMark />
          <span>Preparando seu documento...</span>
        </div>
      )}

      {!pdfDocument ? (
        <EmptyState onPick={(nextFile) => void loadFile(nextFile)} />
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <div className="file-summary">
              <div className="file-icon"><FileCheck2 size={21} /></div>
              <div>
                <strong title={file?.name}>{file?.name}</strong>
                <span>{pdfDocument.numPages} {pdfDocument.numPages === 1 ? 'página' : 'páginas'} · {file && formatBytes(file.size)}</span>
              </div>
            </div>

            <div className="workflow-label">Seu fluxo</div>
            <ol className="steps">
              <li className="done"><span><Check size={13} /></span><div><strong>Documento</strong><small>PDF carregado</small></div></li>
              <li className={formPlacements.length ? 'done' : 'active'}><span>{formPlacements.length ? <Check size={13} /> : '2'}</span><div><strong>Preenchimento</strong><small>{formPlacements.length ? (formPlacements.length === 1 ? '1 item na página' : `${formPlacements.length} itens nas páginas`) : fillDrafts.length ? `${fillDrafts.length} pronto(s) para arrastar` : 'Texto e marcações'}</small></div></li>
              <li className={storedSignature ? 'done' : formPlacements.length ? 'active' : ''}><span>{storedSignature ? <Check size={13} /> : '3'}</span><div><strong>Assinatura</strong><small>{storedSignature ? 'Traço pronto' : 'Opcional'}</small></div></li>
            </ol>

            <div className="form-card desktop-tool-card">
              <div className="tool-card-heading">
                <div className="tool-card-icon"><Type size={17} /></div>
                <div><strong>Preencher formulário</strong><span>Adicione e posicione na página</span></div>
              </div>
              <button className="batch-fill-button" type="button" onClick={() => setBatchFillOpen(true)}>
                <ListPlus size={16} />
                <span><strong>Preparar vários</strong><small>um preenchimento por linha</small></span>
                <ArrowRight size={14} />
              </button>
              <div className="form-actions-label"><span>ou adicione um por vez</span></div>
              <div className="form-actions">
                <button type="button" onClick={() => setTextEditorId('new')}><Type size={15} /><span>Texto</span></button>
                <button type="button" onClick={() => addMark('check')}><SquareCheckBig size={15} /><span>Marcar</span></button>
                <button type="button" onClick={() => addMark('x')}><X size={15} /><span>Inserir X</span></button>
              </div>
              <small>Dê dois cliques em um texto para editá-lo.</small>
            </div>

            <FillTray
              drafts={fillDrafts}
              className="desktop-fill-tray"
              onPlace={(id) => placeFillDraft(id)}
              onDrop={(id, x, y) => placeFillDraft(id, x, y)}
              onRemove={(id) => setFillDrafts((current) => current.filter((item) => item.id !== id))}
              onAddMany={() => setBatchFillOpen(true)}
            />

            <div className="signature-card desktop-tool-card">
              {storedSignature ? (
                <div className="signature-preview">
                  <img src={storedSignature.dataUrl} alt="Assinatura salva" />
                  <span>Sua assinatura</span>
                </div>
              ) : (
                <div className="signature-placeholder"><PenLine size={26} /><span>Nenhuma assinatura criada</span></div>
              )}
              <button className="button primary wide" type="button" onClick={chooseSignatureAction}>
                <PenLine size={17} /> {storedSignature ? 'Adicionar à página' : 'Criar assinatura'}
              </button>
              {storedSignature && (
                <button className="text-button centered" type="button" onClick={() => setSignatureOpen(true)}>
                  Redesenhar assinatura
                </button>
              )}
            </div>

            <div className="page-list-header"><span>Páginas</span><strong>{pageNumber} / {pdfDocument.numPages}</strong></div>
            <div className="page-list" aria-label="Lista de páginas">
              {Array.from({ length: pdfDocument.numPages }, (_, index) => {
                const count = placements.filter((placement) => placement.pageIndex === index).length
                  + formPlacements.filter((placement) => placement.pageIndex === index).length
                return (
                  <button
                    key={index}
                    type="button"
                    className={pageNumber === index + 1 ? 'active' : ''}
                    onClick={() => changePage(index + 1)}
                  >
                    <span>{index + 1}</span>
                    {count > 0 && <i title={`${count} ${count === 1 ? 'item' : 'itens'}`}>{count}</i>}
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="document-area">
            <div className="document-toolbar">
              <div className="page-controls">
                <button className="icon-button" type="button" onClick={() => changePage(pageNumber - 1)} disabled={pageNumber === 1} aria-label="Página anterior"><ChevronLeft size={19} /></button>
                <span>Página <strong>{pageNumber}</strong> de {pdfDocument.numPages}</span>
                <button className="icon-button" type="button" onClick={() => changePage(pageNumber + 1)} disabled={pageNumber === pdfDocument.numPages} aria-label="Próxima página"><ChevronRight size={19} /></button>
              </div>
              <div className="toolbar-hint"><Grip size={15} /> Arraste qualquer item para posicionar</div>
              <div className="zoom-controls">
                <button className="icon-button" type="button" onClick={() => setZoomIndex((index) => Math.max(0, index - 1))} disabled={zoomIndex === 0} aria-label="Diminuir zoom"><Minus size={16} /></button>
                <span>{Math.round(zoom * 100)}%</span>
                <button className="icon-button" type="button" onClick={() => setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1))} disabled={zoomIndex === ZOOM_LEVELS.length - 1} aria-label="Aumentar zoom"><Plus size={16} /></button>
              </div>
            </div>

            <div ref={stageRef} className="canvas-stage" onClick={() => setSelectedId(null)}>
              <PdfCanvas
                document={pdfDocument}
                pageNumber={pageNumber}
                zoom={zoom}
                onSize={handlePageSize}
                onDropDraft={(id, x, y) => placeFillDraft(id, x, y)}
              >
                {currentPlacements.map((placement) => (
                  <SignatureOverlay
                    key={placement.id}
                    placement={placement}
                    selected={selectedId === placement.id}
                    onSelect={() => setSelectedId(placement.id)}
                    onChange={(patch) => updatePlacement(placement.id, patch)}
                    onDuplicate={() => duplicateItem(placement.id)}
                    onDelete={() => deleteItem(placement.id)}
                  />
                ))}
                {currentFormPlacements.map((placement) => (
                  <FormOverlay
                    key={placement.id}
                    placement={placement}
                    selected={selectedId === placement.id}
                    onSelect={() => setSelectedId(placement.id)}
                    onChange={(patch) => updateFormPlacement(placement.id, patch)}
                    onDuplicate={() => duplicateItem(placement.id)}
                    onDelete={() => deleteItem(placement.id)}
                    onEdit={() => setTextEditorId(placement.id)}
                  />
                ))}
              </PdfCanvas>
            </div>

            <div className="mobile-page-nav">
              <button type="button" className="button ghost" onClick={() => changePage(pageNumber - 1)} disabled={pageNumber === 1}><ArrowLeft size={17} /> Anterior</button>
              <span>{pageNumber} / {pdfDocument.numPages}</span>
              <button type="button" className="button ghost" onClick={() => changePage(pageNumber + 1)} disabled={pageNumber === pdfDocument.numPages}>Próxima <ArrowRight size={17} /></button>
            </div>
            <button className="mobile-batch-cta" type="button" onClick={() => setBatchFillOpen(true)}>
              <ListPlus size={17} /><span><strong>Preparar vários dados</strong><small>Digite uma vez e distribua nos campos</small></span><ArrowRight size={16} />
            </button>
            <FillTray
              drafts={fillDrafts}
              className="mobile-fill-tray"
              onPlace={(id) => placeFillDraft(id)}
              onDrop={(id, x, y) => placeFillDraft(id, x, y)}
              onRemove={(id) => setFillDrafts((current) => current.filter((item) => item.id !== id))}
              onAddMany={() => setBatchFillOpen(true)}
            />
            <div className="mobile-tool-dock">
              <button type="button" onClick={() => setTextEditorId('new')}><Type size={17} /><span>Texto</span></button>
              <button type="button" onClick={() => addMark('check')}><SquareCheckBig size={17} /><span>Marcar</span></button>
              <button type="button" onClick={() => addMark('x')}><X size={17} /><span>Inserir X</span></button>
              <button type="button" onClick={chooseSignatureAction}><PenLine size={17} /><span>Assinar</span></button>
            </div>
          </section>

          <aside className="export-bar">
            <div>
              <span className="export-count">{totalItems}</span>
              <p><strong>{totalItems === 1 ? '1 item adicionado' : `${totalItems} itens adicionados`}</strong><small>em {new Set([...placements, ...formPlacements].map((item) => item.pageIndex)).size} {new Set([...placements, ...formPlacements].map((item) => item.pageIndex)).size === 1 ? 'página' : 'páginas'}</small></p>
            </div>
            <button className="button dark" type="button" onClick={() => void exportPdf()} disabled={!totalItems || exporting}>
              {exporting ? <span className="button-spinner" /> : <Download size={18} />}
              {exporting ? 'Gerando PDF...' : 'Baixar PDF final'}
            </button>
          </aside>
        </main>
      )}

      {signatureOpen && <SignaturePad onClose={() => setSignatureOpen(false)} onSave={onSignatureSaved} />}
      {textEditorId && (
        <TextEditorModal
          initial={textBeingEdited ? {
            text: textBeingEdited.text,
            color: textBeingEdited.color,
            fontSize: textBeingEdited.fontSize,
          } : undefined}
          onClose={() => setTextEditorId(null)}
          onSave={saveTextPlacement}
        />
      )}
      {batchFillOpen && <BatchFillModal onClose={() => setBatchFillOpen(false)} onSave={addFillDrafts} />}

      {(notice || error) && (
        <div className={`toast ${error ? 'error' : ''}`} role="status">
          {error ? <X size={17} /> : <Check size={17} />}
          <span>{error || notice}</span>
          <button type="button" onClick={() => { setNotice(null); setError(null) }} aria-label="Fechar aviso"><X size={15} /></button>
        </div>
      )}
    </div>
  )
}
