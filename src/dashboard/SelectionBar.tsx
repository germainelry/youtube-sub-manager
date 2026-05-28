interface Props {
  selectedCount: number;
  filteredCount: number;
  filteredAlreadySelected: number;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  onUnsubscribe: () => void;
}

export function SelectionBar({
  selectedCount,
  filteredCount,
  filteredAlreadySelected,
  onSelectAllFiltered,
  onClear,
  onUnsubscribe,
}: Props): JSX.Element | null {
  if (filteredCount === 0 && selectedCount === 0) return null;

  const remainingToSelect = filteredCount - filteredAlreadySelected;
  const canSelectAll = remainingToSelect > 0;
  const hiddenBySelectFilters = selectedCount - filteredAlreadySelected;
  const selectAllLabel =
    remainingToSelect > 0
      ? `Select all visible (+${remainingToSelect.toLocaleString()})`
      : 'All visible selected';

  return (
    <div className="selection-bar active" role="region" aria-label="Selection actions">
      {selectedCount > 0 ? (
        <span className="count">
          <strong>{selectedCount.toLocaleString()}</strong> selected to unsubscribe
          {hiddenBySelectFilters > 0 && (
            <span className="count-hidden">
              {' '}
              ({hiddenBySelectFilters.toLocaleString()} hidden by filters)
            </span>
          )}
        </span>
      ) : (
        <span className="count">
          <strong>{filteredCount.toLocaleString()}</strong> channels visible
        </span>
      )}
      <button onClick={onSelectAllFiltered} disabled={!canSelectAll}>
        {selectAllLabel}
      </button>
      {selectedCount > 0 && (
        <>
          <button onClick={onClear}>Clear selection</button>
          <button className="danger" onClick={onUnsubscribe}>
            Unsubscribe selected
          </button>
        </>
      )}
    </div>
  );
}
