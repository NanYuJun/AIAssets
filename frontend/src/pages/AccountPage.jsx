import AccountSection from '../components/AccountSection'

export default function AccountPage({ auth, isAdmin, onUpdated, showToast }) {
  return (
    <div className="space-y-4 w-full">
      <AccountSection auth={auth} isAdmin={isAdmin} onUpdated={onUpdated} showToast={showToast} />
    </div>
  )
}
