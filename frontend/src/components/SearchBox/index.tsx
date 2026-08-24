import type { InputHTMLAttributes } from 'react';
import './index.css';

interface SearchBoxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function SearchBox({ value, onChange, placeholder = '搜索...', className, ...rest }: SearchBoxProps) {
  return (
    <div className={`search-box ${className || ''}`}>
      <svg className="search-box__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        className="search-box__input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}