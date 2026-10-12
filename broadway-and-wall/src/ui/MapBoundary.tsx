import { Component, type ReactNode } from "react";

/**
 * A FAULT IN THE PICTURE IS NOT A FAULT IN THE GAME.
 *
 * MapView had no error boundary, so one bad lot in the city renderer (an
 * out-of-range ring index in lotMassing) threw during the map's commit and
 * React unmounted the whole tree — the top bar, the desks, the cards, the
 * save in progress all went to a blank screen. The firm is in the store, not
 * in the map: this keeps every desk working, says what happened, and offers
 * to draw the map again.
 */
export default class MapBoundary extends Component<{ children: ReactNode }, { err: Error | null; tries: number }> {
  state = { err: null as Error | null, tries: 0 };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error("Map renderer fault:", err); }
  render() {
    if (!this.state.err) return <div key={this.state.tries} style={{ display: "contents" }}>{this.props.children}</div>;
    return (
      <div className="map-fault" role="alert">
        <div className="map-fault-card">
          <div className="modal-kicker">The map</div>
          <div className="modal-title">The city could not be drawn this month.</div>
          <div className="modal-sub">
            Your firm is fine — every desk still works and the game keeps saving. The renderer hit a fault:
            <span className="mono"> {this.state.err.message}</span>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => this.setState((s) => ({ err: null, tries: s.tries + 1 }))}>
              Draw it again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
