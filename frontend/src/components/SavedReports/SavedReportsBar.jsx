import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import styles from "./SavedReportsBar.module.css";

const SECTIONS = [
  { level: "system", label: "System Reports" },
  { level: "user", label: "User Reports" },
];

export default function SavedReportsBar({
  reports,
  defaultReportId,
  loadedReportId,
  includeInactive,
  onIncludeInactiveChange,
  onSelectReport,
  error,
  isLoadedDefault = false,
  isLoadedActive = true,
  onToggleDefault,
  onReorder,
  onSortAlphabetical,
}) {
  // When the caller supplies onToggleDefault, the legend slot becomes a
  // ☆/★ Default toggle for the loaded report.  Used for viewers, who don't
  // see the Report Criteria panel that normally hosts this control.
  const showDefaultToggle = !!onToggleDefault;
  const dragEnabled = !!onReorder;

  const grouped = {
    system: reports.filter((r) => r.publication_level === "system"),
    user: reports.filter((r) => r.publication_level === "user"),
  };

  const handleDragEnd = (level) => (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const section = grouped[level];
    const oldIdx = section.findIndex((r) => r.id === active.id);
    const newIdx = section.findIndex((r) => r.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = [...section];
    const [moved] = reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, moved);

    const after = newIdx > 0 ? reordered[newIdx - 1] : null;
    const before = newIdx < reordered.length - 1 ? reordered[newIdx + 1] : null;

    const otherLevel = level === "system" ? "user" : "system";
    const optimisticReports =
      otherLevel === "system"
        ? [...grouped.system, ...reordered]
        : [...reordered, ...grouped.user];

    onReorder({
      reportId: active.id,
      afterId: after?.id ?? null,
      beforeId: before?.id ?? null,
      optimisticReports,
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Reports</span>
        <div className={styles.headerControls}>
          {onSortAlphabetical && reports.length > 1 && (
            <button
              type="button"
              className={styles.sortBtn}
              onClick={onSortAlphabetical}
              title="Sort all your reports alphabetically by name (system and user sections sort independently)"
            >
              Sort Alphabetically
            </button>
          )}
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => onIncludeInactiveChange(e.target.checked)}
            />
            Include Inactive
          </label>
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {reports.length === 0 ? (
        <div className={styles.empty}>
          No saved reports yet. Build a report below and click Save As to save it here.
        </div>
      ) : (
        <div className={styles.sections}>
          {SECTIONS.map(({ level, label }) => {
            const section = grouped[level];
            if (section.length === 0) return null;
            return (
              <Section
                key={level}
                label={label}
                level={level}
                reports={section}
                defaultReportId={defaultReportId}
                loadedReportId={loadedReportId}
                onSelectReport={onSelectReport}
                dragEnabled={dragEnabled}
                onDragEnd={handleDragEnd(level)}
              />
            );
          })}
        </div>
      )}
      {showDefaultToggle ? (
        <div className={styles.defaultToggleSlot}>
          {loadedReportId != null && (
            <button
              type="button"
              className={`${styles.defaultToggle} ${isLoadedDefault ? styles.defaultToggleOn : ""}`}
              onClick={onToggleDefault}
              disabled={!isLoadedActive}
              title={
                !isLoadedActive
                  ? "Reactivate this report to set as default"
                  : isLoadedDefault
                  ? "Unmark as your default"
                  : "Mark as your default for this tab"
              }
            >
              {isLoadedDefault ? "★ Default Report" : "☆ Default Report"}
            </button>
          )}
        </div>
      ) : (
        <div className={styles.legend} aria-label="Report types legend">
          <span className={`${styles.legendBadge} ${styles.badgeSystem}`} aria-hidden="true" />
          <span className={styles.legendLabel}>= system report</span>
          <span className={`${styles.legendBadge} ${styles.badgeUser}`} aria-hidden="true" />
          <span className={styles.legendLabel}>= user-specific report</span>
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  level,
  reports,
  defaultReportId,
  loadedReportId,
  onSelectReport,
  dragEnabled,
  onDragEnd,
}) {
  // 6px activation distance lets a quick click still fire onSelectReport;
  // a deliberate drag past the threshold starts a reorder instead.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const badges = reports.map((r) => (
    <SortableBadge
      key={r.id}
      report={r}
      isLoaded={r.id === loadedReportId}
      isDefault={r.id === defaultReportId}
      onSelect={() => onSelectReport(r.id)}
      dragEnabled={dragEnabled}
    />
  ));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>{label}</div>
      {dragEnabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={reports.map((r) => r.id)}
            strategy={rectSortingStrategy}
          >
            <div className={styles.badgeRow}>{badges}</div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className={styles.badgeRow}>{badges}</div>
      )}
    </div>
  );
}

function SortableBadge({ report, isLoaded, isDefault, onSelect, dragEnabled }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: report.id, disabled: !dragEnabled });

  const isSystem = report.publication_level === "system";
  const cls = [
    styles.badge,
    isSystem ? styles.badgeSystem : styles.badgeUser,
    isLoaded ? styles.badgeLoaded : "",
    isDefault ? styles.badgeDefault : "",
    !report.is_active ? styles.badgeInactive : "",
    isDragging ? styles.badgeDragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cls}
      style={style}
      onClick={onSelect}
      title={isDefault ? `${report.display_name} (your default)` : report.display_name}
      {...attributes}
      {...listeners}
    >
      {isDefault && <span className={styles.defaultMark} aria-hidden="true">★</span>}
      {report.display_name}
      {!report.is_active && <span className={styles.inactiveTag}> (inactive)</span>}
    </button>
  );
}
