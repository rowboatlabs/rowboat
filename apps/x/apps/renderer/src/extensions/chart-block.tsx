import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { X, BarChart3 } from 'lucide-react'
import { blocks } from '@x/shared'
import { useState, useEffect } from 'react'
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const CHART_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f']

function ChartBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.ChartBlock | null = null

  try {
    config = blocks.ChartBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  const [fileData, setFileData] = useState<Record<string, unknown>[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!config?.source) return
    setLoading(true)
    setError(null)
    ;(window as unknown as { ipc: { invoke: (channel: string, args: Record<string, string>) => Promise<string> } })
      .ipc.invoke('workspace:readFile', { path: config.source, encoding: 'utf-8' })
      .then((content: string) => {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          setFileData(parsed)
        } else {
          setError('Source file must contain a JSON array')
        }
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to load data file')
      })
      .finally(() => setLoading(false))
  }, [config?.source])

  if (!config) {
    return (
      <NodeViewWrapper className="chart-block-wrapper" data-type="chart-block">
        <div className="chart-block-card chart-block-error">
          <BarChart3 size={16} />
          <span>Invalid chart block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const data = config.data || fileData

  const renderChart = () => {
    if (loading) return <div className="chart-block-loading">Loading data...</div>
    if (error) return <div className="chart-block-error-msg">{error}</div>
    if (!data || data.length === 0) return <div className="chart-block-empty">No data</div>

    return (
      <ResponsiveContainer width="100%" height={250}>
        {config!.chart === 'line' ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={config!.x} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey={config!.y} stroke="#8884d8" />
          </LineChart>
        ) : config!.chart === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={config!.x} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey={config!.y} fill="#8884d8" />
          </BarChart>
        ) : (
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie data={data} dataKey={config!.y} nameKey={config!.x} cx="50%" cy="50%" outerRadius={80} label>
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    )
  }

  return (
    <NodeViewWrapper className="chart-block-wrapper" data-type="chart-block">
      <div className="chart-block-card">
        <button
          className="chart-block-delete"
          onClick={deleteNode}
          aria-label="Delete chart block"
        >
          <X size={14} />
        </button>
        {config.title && <div className="chart-block-title">{config.title}</div>}
        {renderChart()}
      </div>
    </NodeViewWrapper>
  )
}

export const ChartBlockExtension = Node.create({
  name: 'chartBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: '{}',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        priority: 60,
        getAttrs(element) {
          const code = element.querySelector('code')
          if (!code) return false
          const cls = code.className || ''
          if (cls.includes('language-chart')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'chart-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```chart\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {
          // handled by parseHTML
        },
      },
    }
  },
})
