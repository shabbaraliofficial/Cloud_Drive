export const folders = [
  { id: 'f1', name: 'Brand Kit', files: 24, updated: 'Edited 2h ago', color: 'from-sky-500 to-blue-600', location: 'My Drive', shared: false, starred: true },
  { id: 'f2', name: 'Client Contracts', files: 9, updated: 'Opened yesterday', color: 'from-emerald-500 to-teal-600', location: 'My Drive', shared: false, starred: false },
  { id: 'f3', name: 'Marketing Assets', files: 34, updated: 'Uploaded 4h ago', color: 'from-orange-500 to-amber-600', location: 'Shared', shared: true, starred: true },
  { id: 'f4', name: 'Design Sprint', files: 12, updated: 'Edited 1 day ago', color: 'from-violet-500 to-indigo-600', location: 'Shared', shared: true, starred: false },
  { id: 'f5', name: 'Product Specs', files: 15, updated: 'Opened today', color: 'from-cyan-500 to-sky-600', location: 'My Drive', shared: false, starred: false },
]

export const files = [
  { id: 'file-1', name: 'Q1-Business-Plan.pdf', activity: 'Uploaded 45m ago', owner: 'You', location: 'My Drive', shared: false, starred: true, deleted: false, fromComputer: false, size: '8.2 MB' },
  { id: 'file-2', name: 'Homepage-UI-v12.fig', activity: 'Edited 2h ago', owner: 'Amelia Kent', location: 'Shared', shared: true, starred: true, deleted: false, fromComputer: false, size: '34 MB' },
  { id: 'file-3', name: 'Hiring-Pipeline.xlsx', activity: 'Opened yesterday', owner: 'You', location: 'My Drive', shared: false, starred: false, deleted: false, fromComputer: false, size: '1.4 MB' },
  { id: 'file-4', name: 'Campaign-Storyboard.pptx', activity: 'Edited 3 days ago', owner: 'Noah Green', location: 'Shared', shared: true, starred: false, deleted: false, fromComputer: false, size: '11 MB' },
  { id: 'file-5', name: 'Weekly-Finance.csv', activity: 'Uploaded 5 days ago', owner: 'You', location: 'My Drive', shared: false, starred: false, deleted: false, fromComputer: false, size: '860 KB' },
  { id: 'file-6', name: 'Device-Backup.zip', activity: 'Backed up 6h ago', owner: 'You', location: 'Computer', shared: false, starred: false, deleted: false, fromComputer: true, size: '1.8 GB' },
  { id: 'file-7', name: 'Screen-Recording.mp4', activity: 'Backed up yesterday', owner: 'You', location: 'Computer', shared: false, starred: true, deleted: false, fromComputer: true, size: '428 MB' },
  { id: 'file-8', name: 'Old-Proposal-v2.docx', activity: 'Deleted 2 days ago', owner: 'You', location: 'Bin', shared: false, starred: false, deleted: true, fromComputer: false, size: '2.1 MB' },
  { id: 'file-9', name: 'Unused-Asset.ai', activity: 'Deleted 5 days ago', owner: 'You', location: 'Bin', shared: false, starred: false, deleted: true, fromComputer: false, size: '19 MB' },
]

export const computerDevices = [
  { name: 'MacBook Pro 14"', lastSync: '10 minutes ago', status: 'Active backup', files: 1832 },
  { name: 'Office Windows PC', lastSync: '2 hours ago', status: 'Backup healthy', files: 2491 },
]

export const storage = {
  usedPercent: 68,
  used: '102 GB',
  available: '48 GB of 150 GB',
}
