export const registryConfig = {
	firstIssueDate: '2026-01-01',
	entityTypeId: 1404,
	linkMode: 'crm',
	fields: {
		company: 'ufCrm353FsCompany',
		kind: 'ufCrm353FsKind',
		buyer: 'ufCrm353FsBuyer',
		nip: 'ufCrm353FsNip',
		issued: 'ufCrm353FsIssued',
		due: 'ufCrm353FsDue',
		status: 'ufCrm353FsStatus',
		overdue: 'ufCrm353FsOverdue',
		gross: 'ufCrm353FsGross',
		paid: 'ufCrm353FsPaid',
		balance: 'ufCrm353FsBalance',
		pdfUrl: 'ufCrm353FsPdfUrl',
		bases: 'ufCrm353FsBases',
		derived: 'ufCrm353FsDerived'
	},
	kinds: {
		proforma: 10289,
		vat: 10291,
		final: 10293,
		advance: 10295,
		correction: 10297,
		bill: 10299
	},
	statuses: {
		issued: 10301,
		sent: 10303,
		partial: 10305,
		paid: 10307,
		rejected: 10309,
		cancelled: 10311
	}
};
