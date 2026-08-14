import { useState, useRef, useEffect } from 'react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
  desc?: string;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  onOpen?: () => void;
}

export default function Select({ value, options, onChange, placeholder, onOpen }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={styles.select} ref={containerRef}>
      <div
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => {
          if (!open && onOpen) onOpen();
          setOpen(!open);
        }}
      >
        {selected ? (
          <span className={styles.triggerText}>
            <span className={styles.triggerLabel}>{selected.label}</span>
            {selected.desc && <span className={styles.triggerDesc}>{selected.desc}</span>}
          </span>
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
        <span className={styles.arrow}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.list}>
            {options.map((option) => (
              <div
                key={option.value}
                className={`${styles.option} ${option.value === value ? styles.optionSelected : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className={styles.optionLabel}>{option.label}</span>
                {option.desc && <span className={styles.optionDesc}>{option.desc}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}