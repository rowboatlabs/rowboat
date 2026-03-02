interface TagPillsProps {
  tags: string[]
}

export function TagPills({ tags }: TagPillsProps) {
  if (tags.length === 0) return null

  return (
    <div className="tag-pills-row">
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className="tag-pill">
          {tag}
        </span>
      ))}
    </div>
  )
}
