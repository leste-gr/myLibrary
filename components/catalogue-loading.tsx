export function CollectionListSkeleton({ label }: { label: string }) {
  return <section className="catalogue-loading" aria-busy="true" aria-label={label}>
    <p role="status">{label}</p><div className="collection-grid" aria-hidden="true">{[0,1,2].map(index => <div className="collection-card skeleton-collection" key={index}><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>)}</div>
  </section>;
}
export function CollectionContentsSkeleton({ label }: { label: string }) {
  return <main className="catalogue-shell catalogue-loading" aria-busy="true" aria-label={label}>
    <p role="status">{label}</p><div className="book-grid" aria-hidden="true">{[0,1,2,3,4,5,6,7].map(index => <div key={index}><div className="skeleton-cover" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>)}</div>
  </main>;
}
