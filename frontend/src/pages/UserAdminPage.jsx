import UserAdminSection from '../components/UserAdminSection'

export default function UserAdminPage({ auth, users, isAdmin, onUpdated, showToast }) {
  return (
    <div className="space-y-4 w-full">
      <UserAdminSection auth={auth} users={users} isAdmin={isAdmin} onUpdated={onUpdated} showToast={showToast} />
    </div>
  )
}
