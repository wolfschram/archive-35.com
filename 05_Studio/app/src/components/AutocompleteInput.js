import React, { useState, useEffect, useRef, useMemo } from 'react';

/**
 * Calculate Levenshtein distance between two strings
 * Measures minimum edits (insertions, deletions, substitutions) needed to transform one string to another
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Score a match between user input and a candidate
 * Returns { score, candidate, matchType } where lower score = better match
 * - matchType: 'exact', 'substring', 'alias', 'fuzzy', or null
 */
function fuzzyScore(input, candidate, aliases = []) {
  const inputLower = input.toLowerCase();
  const candidateLower = candidate.toLowerCase();

  // Exact match
  if (inputLower === candidateLower) {
    return { score: 0, candidate, matchType: 'exact' };
  }

  // Check aliases
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();
    if (inputLower === aliasLower) {
      return { score: 0, candidate, matchType: 'alias' };
    }
  }

  // Substring match (very good)
  if (candidateLower.includes(inputLower)) {
    const positionPenalty = candidateLower.indexOf(inputLower) * 0.1;
    return { score: 1 + positionPenalty, candidate, matchType: 'substring' };
  }

  // Check if input is substring of alias
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();
    if (aliasLower.includes(inputLower)) {
      const positionPenalty = aliasLower.indexOf(inputLower) * 0.1;
      return { score: 1.5 + positionPenalty, candidate, matchType: 'alias_substring' };
    }
  }

  // Levenshtein distance (fuzzy) — with relative threshold
  // A real typo changes ~1-2 characters, not 60% of the word
  const distance = levenshtein(inputLower, candidateLower);
  const maxLen = Math.max(inputLower.length, candidateLower.length);
  const similarity = 1 - (distance / maxLen);

  // Only consider it a typo match if:
  //  - At least 50% of characters are the same (similarity >= 0.5)
  //  - AND they share the same first letter (most typos preserve the start)
  //  - AND edit distance is <= 2 (real typos are 1-2 chars, not 4+)
  if (distance > 0 && distance <= 2 && similarity >= 0.5 && inputLower[0] === candidateLower[0]) {
    return { score: distance + 2, candidate, matchType: 'fuzzy' };
  }

  return { score: Infinity, candidate, matchType: null };
}

/**
 * AutocompleteInput - Reusable fuzzy autocomplete component for location/portfolio entry
 *
 * Props:
 *   value: string - current input value
 *   onChange: function - called with new value as user types
 *   placeholder: string - input placeholder text
 *   suggestions: array - list of { name, aliases? } objects to match against
 *   label: string - form label
 *   helpText: string - optional help text below input
 *   maxSuggestions: number - max dropdown items to show (default: 8)
 *   fuzzyThreshold: number - max edit distance to show suggestion (default: 3)
 */
function AutocompleteInput({
  value,
  onChange,
  placeholder = '',
  suggestions = [],
  label = '',
  helpText = '',
  maxSuggestions = 8,
  fuzzyThreshold = 3,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [matches, setMatches] = useState([]);
  const [matchType, setMatchType] = useState(null);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  // Generate flat list of candidates with aliases
  // Memoized with serialized key — parent may pass new array refs each render
  const suggestionsKey = JSON.stringify(suggestions);
  const candidates = useMemo(() => suggestions.flatMap(item => {
    const name = typeof item === 'string' ? item : item.name;
    const aliases = typeof item === 'string' ? [] : (item.aliases || []);
    return { name, aliases };
  }), [suggestionsKey]); // eslint-disable-line

  // Update suggestions on input change
  useEffect(() => {
    if (value.length < 2) {
      setMatches([]);
      setIsOpen(false);
      setHighlightedIndex(-1);
      setMatchType(null);
      return;
    }

    // Score all candidates
    const scored = candidates
      .map(c => fuzzyScore(value, c.name, c.aliases))
      .filter(m => m.matchType !== null && m.score <= fuzzyThreshold + 3)
      .sort((a, b) => a.score - b.score)
      .slice(0, maxSuggestions);

    setMatches(scored);
    setIsOpen(scored.length > 0);
    setHighlightedIndex(-1);

    // Determine match type
    if (scored.length > 0) {
      setMatchType(scored[0].matchType);
    } else {
      setMatchType(null);
    }
  }, [value, candidates, maxSuggestions, fuzzyThreshold]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < matches.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && matches[highlightedIndex]) {
          onChange(matches[highlightedIndex].candidate);
          setIsOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const handleSelect = (candidate) => {
    onChange(candidate);
    setIsOpen(false);
  };

  // Determine if we should show warning badge
  const showWarningBadge = value.length >= 2 && matches.length > 0 && matchType !== 'exact' && matchType !== 'alias';
  const bestMatch = matches.length > 0 ? matches[0].candidate : null;

  return (
    <div className="form-group autocomplete-wrapper" ref={wrapperRef}>
      {label && <label>{label}</label>}

      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => value.length >= 2 && setIsOpen(true)}
          placeholder={placeholder}
          style={{
            paddingRight: showWarningBadge ? '32px' : undefined,
          }}
        />

        {/* Warning badge for close matches */}
        {showWarningBadge && (
          <div
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '12px',
              padding: '4px 8px',
              background: 'rgba(251, 191, 36, 0.2)',
              color: 'var(--warning)',
              borderRadius: '4px',
              fontWeight: 600,
              pointerEvents: 'none',
            }}
            title={`Did you mean "${bestMatch}"?`}
          >
            !
          </div>
        )}

        {/* Dropdown suggestions */}
        {isOpen && matches.length > 0 && (
          <div className="autocomplete-dropdown">
            {matches.map((match, index) => (
              <div
                key={`${match.candidate}-${index}`}
                className={`autocomplete-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                onClick={() => handleSelect(match.candidate)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="autocomplete-text">{match.candidate}</span>
                {match.matchType === 'exact' && (
                  <span className="autocomplete-badge exact">Exact</span>
                )}
                {match.matchType === 'alias' && (
                  <span className="autocomplete-badge alias">Alias</span>
                )}
                {match.matchType === 'substring' && (
                  <span className="autocomplete-badge substring">Contains</span>
                )}
                {match.matchType === 'fuzzy' && (
                  <span className="autocomplete-badge fuzzy">Typo Match</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {helpText && (
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
          {helpText}
        </span>
      )}
    </div>
  );
}

export default AutocompleteInput;
