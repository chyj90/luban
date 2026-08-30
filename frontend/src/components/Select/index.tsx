import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.css';

interface SelectOption {
  value: string;
  label: string;
  desc?: string;
  children?: SelectOption[];
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  onOpen?: () => void;
  className?: string;
  disabled?: boolean;
  multiple?: false;
  multiValue?: never;
  onMultiChange?: never;
}

interface MultiSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  onOpen?: () => void;
  className?: string;
  disabled?: boolean;
  multiple: true;
  multiValue: string[];
  onMultiChange: (value: string[]) => void;
}

type Props = SelectProps | MultiSelectProps;

function findOption(options: SelectOption[], value: string): SelectOption | undefined {
  for (const opt of options) {
    if (opt.value === value) return opt;
    if (opt.children) {
      const found = findOption(opt.children, value);
      if (found) return found;
    }
  }
}

const MAX_DROPDOWN = 300;
const GAP = 4;

export default function Select(props: Props) {
  const { value, options, onChange, placeholder, onOpen, className, disabled } = props;
  const multiple = props.multiple === true;
  const multiValue: string[] = multiple ? props.multiValue : [];
  const onMultiChange: ((v: string[]) => void) | undefined = multiple ? props.onMultiChange : undefined;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  const [expandedValues, setExpandedValues] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const measure = useCallback(() => {
    if (!containerRef.current || !dropdownRef.current) return;
    const trigger = containerRef.current.getBoundingClientRect();
    const contentHeight = dropdownRef.current.scrollHeight;
    const spaceBelow = window.innerHeight - trigger.bottom - GAP;
    const spaceAbove = trigger.top - GAP;

    if (spaceBelow >= contentHeight || spaceBelow >= spaceAbove) {
      const h = Math.min(spaceBelow, MAX_DROPDOWN);
      setPos({ left: trigger.left, top: trigger.bottom + GAP, width: trigger.width });
      setDropStyle({ maxHeight: h, bottom: 'auto' });
    } else {
      const h = Math.min(spaceAbove, MAX_DROPDOWN);
      setPos({
        left: trigger.left,
        top: 0,
        width: trigger.width,
      });
      setDropStyle({ maxHeight: h, bottom: window.innerHeight - trigger.top + GAP, top: 'auto' });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) {
      measure();
    }
  }, [open, measure]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!open) {
      if (onOpen) onOpen();
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const toggleExpand = (val: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedValues((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const selected = multiple ? null : findOption(options, value);

  const handleMultiToggle = (optValue: string) => {
    if (!onMultiChange) return;
    const newValue = multiValue.includes(optValue)
      ? multiValue.filter((v) => v !== optValue)
      : [...multiValue, optValue];
    onMultiChange(newValue);
  };

  const renderOption = (option: SelectOption, level: number) => {
    const hasChildren = option.children && option.children.length > 0;
    const isExpanded = expandedValues.has(option.value);
    const isChecked = multiple && multiValue.includes(option.value);

    return (
      <div key={option.value}>
        <div
          className={`${styles.option} ${!multiple && option.value === value ? styles.optionSelected : ''}`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
          onClick={() => {
            if (multiple) {
              handleMultiToggle(option.value);
            } else {
              onChange(option.value);
              setOpen(false);
            }
          }}
        >
          <span className={styles.optionLeft}>
            {multiple && (
              <span className={`${styles.checkbox} ${isChecked ? styles.checkboxChecked : ''}`}>
                {isChecked ? '☑' : '☐'}
              </span>
            )}
            {hasChildren && (
              <span
                className={styles.expandIcon}
                onClick={(e) => toggleExpand(option.value, e)}
              >
                {isExpanded ? '▼' : '▶'}
              </span>
            )}
            <span className={styles.optionLabel}>{option.label}</span>
          </span>
          {option.desc && <span className={styles.optionDesc}>{option.desc}</span>}
        </div>
        {hasChildren && isExpanded && option.children!.map((child) => renderOption(child, level + 1))}
      </div>
    );
  };

  const dropdownNode = (
    <div
      className={styles.dropdown}
      ref={dropdownRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: pos.width,
        ...dropStyle,
      }}
    >
      <div className={styles.list}>
        {options.map((option) => renderOption(option, 0))}
      </div>
    </div>
  );

  return (
    <div className={`${styles.select} ${className || ''}`} ref={containerRef}>
      <div
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''} ${disabled ? styles.triggerDisabled : ''}`}
        onClick={toggleOpen}
      >
        {multiple ? (
          multiValue.length > 0 ? (
            <span className={styles.triggerText}>
              <span className={styles.triggerLabel}>已选 {multiValue.length} 个</span>
            </span>
          ) : (
            <span className={styles.placeholder}>{placeholder}</span>
          )
        ) : selected ? (
          <span className={styles.triggerText}>
            <span className={styles.triggerLabel}>{selected.label}</span>
            {selected.desc && <span className={styles.triggerDesc}>{selected.desc}</span>}
          </span>
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
        <span className={styles.arrow}>{open ? '▲' : '▼'}</span>
      </div>

      {open && createPortal(dropdownNode, document.body)}
    </div>
  );
}