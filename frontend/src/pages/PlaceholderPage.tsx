import './PlaceholderPage.css';

interface Props {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="placeholder-page">
      <div className="placeholder-page-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#1677ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </div>
      <h2 className="placeholder-page-title">{title}</h2>
      {description && <p className="placeholder-page-desc">{description}</p>}
    </div>
  );
}