// Email-keyed user dropdown. The selected value passed to onChange is the
// email; options display "Name (email)" when name is set, else just email.
// Users with `user_status === "inactive"` get a " — inactive" suffix so admins
// can tell which accounts are not yet active.
export default function UserSelect({
  users,
  value,
  onChange,
  className,
  autoFocus = false,
  disabled = false,
  placeholder = "— Select a user —",
}) {
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {users.map(({ email, name, user_status }) => {
        const base = name ? `${name} (${email})` : email;
        const label = user_status === "inactive" ? `${base} — inactive` : base;
        return (
          <option key={email} value={email}>
            {label}
          </option>
        );
      })}
    </select>
  );
}
