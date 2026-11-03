import SwiftUI
import UIKit
import WidgetKit

// Home screen widgets: "Als Nächstes", "Überblick" and "Schnellaktionen". The figures come from the app
// (shared App Group); days until a date are counted here and the timeline refreshes after midnight.

@main
struct HausakteWidgets: WidgetBundle {
    var body: some Widget {
        NextWidget()
        OverviewWidget()
        QuickWidget()
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let model: WidgetModel?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), model: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), model: WidgetModel.load() ?? (context.isPreview ? .sample : nil)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let now = Date()
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) ?? now.addingTimeInterval(3600)
        let entries = [Entry(date: now, model: WidgetModel.load()), Entry(date: tomorrow.addingTimeInterval(60), model: WidgetModel.load())]
        completion(Timeline(entries: entries, policy: .after(tomorrow.addingTimeInterval(120))))
    }
}

// MARK: - look

enum Palette {
    static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }

    static let background = dynamic(0xFFFFFF, 0x1C2131)
    static let tile = dynamic(0xF2F3F8, 0x262C3E)
    static let soft = dynamic(0xE2F3EB, 0x173A2E)
    static let ink = dynamic(0x1B2032, 0xE8EBF4)
    static let ink2 = dynamic(0x5C6378, 0xA7AEC3)
    static let accent = dynamic(0x17936A, 0x35C08F)
    static let accentInk = dynamic(0x0D6A4B, 0x7FE2BD)
    static let warn = dynamic(0xA9530E, 0xF7BD85)
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

extension View {
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { color }
        } else {
            self.padding(14).background(color)
        }
    }
}

let appLink = URL(string: "hausakte://ansicht/cockpit")!

struct Header: View {
    let title: String
    let model: WidgetModel?

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "house.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: 6).fill(Palette.accent))
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(Palette.ink).lineLimit(1)
            Spacer(minLength: 4)
            Text(Fmt.stand(model)).font(.system(size: 11)).foregroundColor(Palette.ink2).lineLimit(1)
        }
    }
}

// MARK: - Als Nächstes

struct NextWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "next", provider: Provider()) { entry in
            NextView(entry: entry)
        }
        .configurationDisplayName("Als Nächstes")
        .description("Heute und die nächsten Termine, Fristen und fälligen Rechnungen.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct NextView: View {
    let entry: Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let today = entry.model?.todayItems(on: entry.date) ?? []
        let rows = entry.model?.upcoming(on: entry.date) ?? []
        let limit = family == .systemLarge ? 8 : (today.isEmpty ? 4 : 2)
        VStack(alignment: .leading, spacing: 6) {
            Header(title: "Als Nächstes", model: entry.model)
            if entry.model == nil {
                Spacer()
                Text("Öffne die Hausakte einmal – dann stehen hier deine nächsten Termine.")
                    .font(.system(size: 13)).foregroundColor(Palette.ink2)
                Spacer()
            } else {
                if let t = today.first {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Heute · " + t.title + (today.count > 1 ? " (+\(today.count - 1))" : ""))
                            .font(.system(size: 13, weight: .bold)).foregroundColor(Palette.accentInk).lineLimit(1)
                        if let s = t.sub, !s.isEmpty {
                            Text(s).font(.system(size: 12)).foregroundColor(Palette.ink2).lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.soft))
                }
                ForEach(Array(rows.prefix(limit))) { item in
                    let n = Fmt.days(item.date, from: entry.date)
                    let urgent = (n ?? 99) <= 7 && ["funding", "milestone", "invoice", "todo"].contains(item.kind ?? "")
                    HStack(spacing: 8) {
                        Text(n == 0 ? "Heute" : Fmt.weekdayDate(item.date))
                            .font(.system(size: 13, weight: .bold)).foregroundColor(Palette.ink)
                            .frame(width: 70, alignment: .leading)
                        Text(item.title).font(.system(size: 13)).foregroundColor(Palette.ink).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(Fmt.inDays(n)).font(.system(size: 12, weight: urgent ? .bold : .regular))
                            .foregroundColor(urgent ? Palette.warn : Palette.ink2)
                    }
                }
                if rows.isEmpty && today.isEmpty {
                    Text("Keine anstehenden Termine.").font(.system(size: 13)).foregroundColor(Palette.ink2)
                }
                Spacer(minLength: 0)
            }
        }
        .widgetURL(appLink)
        .widgetBackground(Palette.background)
    }
}

// MARK: - Überblick

struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "overview", provider: Provider()) { entry in
            OverviewView(entry: entry)
        }
        .configurationDisplayName("Überblick")
        .description("Offene Rechnungen, To-dos und der nächste Termin.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct Tile: View {
    let icon: String
    let label: String
    let value: String
    let sub: String
    var tone: Color = Palette.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .semibold)).foregroundColor(Palette.accent)
                Text(label).font(.system(size: 11)).foregroundColor(Palette.ink2).lineLimit(1)
            }
            Text(value).font(.system(size: 18, weight: .bold)).foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.7)
            Text(sub).font(.system(size: 11)).foregroundColor(Palette.ink2).lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Palette.tile))
    }
}

struct OverviewView: View {
    let entry: Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        let m = entry.model
        let inv = m?.invoices
        let overdue = (inv?.overdueN ?? 0) > 0
        let invTile: Tile = {
            guard m != nil else { return Tile(icon: "eurosign.circle", label: "Rechnungen", value: "–", sub: "App öffnen") }
            if overdue {
                return Tile(icon: "eurosign.circle", label: "Überfällig", value: Fmt.euro(inv?.overdue), sub: "\(inv?.overdueN ?? 0) Rechnung(en)", tone: Palette.warn)
            }
            let due = Fmt.days(inv?.nextDue, from: entry.date)
            let sub = (inv?.openN ?? 0) == 0 ? "alles bezahlt" : (due != nil ? "fällig \(Fmt.inDays(due))" : "\(inv?.openN ?? 0) offen")
            return Tile(icon: "eurosign.circle", label: "Rechnungen offen", value: Fmt.euro(inv?.open), sub: sub)
        }()
        let todoTile = Tile(icon: "checklist", label: "To-dos", value: m == nil ? "–" : "\(m?.todos ?? 0)", sub: (m?.todosLate ?? 0) > 0 ? "\(m?.todosLate ?? 0) überfällig" : "offen")
        let first = m?.upcoming(on: entry.date).first
        let nextTile = Tile(icon: "calendar", label: "Nächster Termin", value: first == nil ? "–" : Fmt.inDays(Fmt.days(first?.date, from: entry.date)), sub: first?.title ?? "keine Termine")
        Group {
            if family == .systemSmall {
                VStack(spacing: 6) {
                    invTile
                    nextTile
                }
            } else {
                HStack(spacing: 6) {
                    invTile
                    todoTile
                    nextTile
                }
            }
        }
        .widgetURL(URL(string: overdue || family == .systemSmall ? "hausakte://ansicht/rechnungen" : "hausakte://ansicht/cockpit"))
        .widgetBackground(Palette.background)
    }
}

// MARK: - Schnellaktionen

struct QuickWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "quick", provider: Provider()) { entry in
            QuickView()
        }
        .configurationDisplayName("Schnellaktionen")
        .description("Rechnung fotografieren, Notiz sprechen, To-do anlegen, Grundriss.")
        .supportedFamilies([.systemMedium])
    }
}

struct QuickButton: View {
    let icon: String
    let label: String
    let link: String
    var primary = false

    var body: some View {
        Link(destination: URL(string: link)!) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 20, weight: .semibold))
                Text(label).font(.system(size: 12, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundColor(primary ? .white : Palette.ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(RoundedRectangle(cornerRadius: 16).fill(primary ? Palette.accent : Palette.tile))
        }
    }
}

struct QuickView: View {
    var body: some View {
        HStack(spacing: 6) {
            QuickButton(icon: "camera", label: "Rechnung", link: "hausakte://aktion/rechnung", primary: true)
            QuickButton(icon: "mic", label: "Notiz", link: "hausakte://aktion/notiz")
            QuickButton(icon: "checklist", label: "To-do", link: "hausakte://aktion/todo")
            QuickButton(icon: "square.grid.2x2", label: "Grundriss", link: "hausakte://ansicht/grundriss")
        }
        .widgetBackground(Palette.background)
    }
}
