import Foundation

/// Figures for the widgets. The web app sends them as JSON whenever its data changes (src/native.js);
/// the app stores them in the shared App Group so the widget extension can read them.
enum Shared {
    static let appGroup = "group.app.hausakte"
    static let key = "widgets"
    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

struct WidgetModel: Codable {
    struct Today: Codable {
        var title: String
        var sub: String?
    }

    struct Item: Codable, Identifiable {
        var date: String
        var title: String
        var sub: String?
        var kind: String?
        var id: String { date + "|" + title }
    }

    struct Invoices: Codable {
        var open: Double?
        var openN: Int?
        var overdue: Double?
        var overdueN: Int?
        var nextDue: String?
    }

    struct Progress: Codable {
        var done: Int
        var total: Int
    }

    var at: Double?
    var house: String?
    var today: [Today]?
    var next: [Item]?
    var invoices: Invoices?
    var todos: Int?
    var todosLate: Int?
    var progress: Progress?
    var attention: Int?

    static func load() -> WidgetModel? {
        guard let data = Shared.defaults?.data(forKey: Shared.key) else { return nil }
        return try? JSONDecoder().decode(WidgetModel.self, from: data)
    }

    static func save(json: String) {
        Shared.defaults?.set(Data(json.utf8), forKey: Shared.key)
    }

    /// The day the data was sent (today's items are only valid on that day).
    var sentDay: Date? {
        guard let at, at > 0 else { return nil }
        return Calendar.current.startOfDay(for: Date(timeIntervalSince1970: at / 1000))
    }

    /// Upcoming items as seen on a given day (past ones are left out).
    func upcoming(on day: Date) -> [Item] {
        (next ?? []).filter { (Fmt.days($0.date, from: day) ?? -1) >= 0 }
    }

    func todayItems(on day: Date) -> [Today] {
        guard let sentDay, Calendar.current.isDate(sentDay, inSameDayAs: day) else { return [] }
        return today ?? []
    }

    static let sample = WidgetModel(
        at: Date().timeIntervalSince1970 * 1000,
        house: "Mein Haus",
        today: [Today(title: "Start: Elektrik erneuern", sub: "bis 11.12. · 6 offene To-dos")],
        next: [
            Item(date: Fmt.iso.string(from: Date().addingTimeInterval(86400 * 18)), title: "Energieberater beauftragen", sub: "Wärmepumpe", kind: "milestone"),
            Item(date: Fmt.iso.string(from: Date().addingTimeInterval(86400 * 25)), title: "Rechnung fällig: Landkreis", sub: "40,00 €", kind: "invoice"),
            Item(date: Fmt.iso.string(from: Date().addingTimeInterval(86400 * 39)), title: "Ende: Elektrik erneuern", sub: nil, kind: "end"),
            Item(date: Fmt.iso.string(from: Date().addingTimeInterval(86400 * 43)), title: "Angebote Wärmepumpe", sub: nil, kind: "milestone"),
        ],
        invoices: Invoices(open: 40, openN: 1, overdue: 0, overdueN: 0, nextDue: Fmt.iso.string(from: Date().addingTimeInterval(86400 * 25))),
        todos: 21,
        todosLate: 0,
        progress: Progress(done: 0, total: 9),
        attention: 4
    )
}

enum Fmt {
    static let iso: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let weekday: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "EEEEEE dd.MM."
        return f
    }()

    private static let time: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "HH:mm"
        return f
    }()

    private static let dayTime: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "dd.MM. HH:mm"
        return f
    }()

    private static let currency: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: "de_DE")
        f.currencyCode = "EUR"
        return f
    }()

    static func date(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return iso.date(from: s)
    }

    static func days(_ s: String?, from now: Date = Date()) -> Int? {
        guard let d = date(s) else { return nil }
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: d)).day
    }

    static func inDays(_ n: Int?) -> String {
        guard let n else { return "" }
        switch n {
        case 0: return "heute"
        case 1: return "morgen"
        case -1: return "gestern"
        default: return n > 0 ? "in \(n) T." : "vor \(-n) T."
        }
    }

    static func weekdayDate(_ s: String?) -> String {
        guard let d = date(s) else { return "" }
        return weekday.string(from: d)
    }

    static func euro(_ v: Double?) -> String {
        currency.string(from: NSNumber(value: v ?? 0)) ?? "–"
    }

    static func stand(_ model: WidgetModel?) -> String {
        guard let at = model?.at, at > 0 else { return "" }
        let t = Date(timeIntervalSince1970: at / 1000)
        return "Stand " + (Calendar.current.isDateInToday(t) ? time.string(from: t) : dayTime.string(from: t))
    }
}
