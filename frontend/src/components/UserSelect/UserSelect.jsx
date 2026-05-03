// Email-keyed user dropdown. The selected value passed to onChange is the
// email; options display "Name (email)" when name is set, else just email.
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
      {users.map(({ email, name }) => (
        <option key={email} value={email}>
          {name ? `${name} (${email})` : email}
        </option>
      ))}
    </select>
  );
}
