import { useParams } from 'react-router-dom'

import DashboardPage from './DashboardPage'

function FolderPage() {
  const { folderId } = useParams()
  return <DashboardPage forcedFolderId={folderId || null} />
}

export default FolderPage
