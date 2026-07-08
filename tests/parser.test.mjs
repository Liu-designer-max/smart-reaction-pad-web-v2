import test from "node:test";
import assert from "node:assert/strict";
import { LineJsonParser } from "../ble.js";

test("BLE parser handles split chunks and multiple lines", () => {
  const events = [];
  const parser = new LineJsonParser((event) => events.push(event));
  parser.pushText('{"event":"trial","trial":1');
  parser.pushText('}\n{"event":"trial","trial":2}\n{"event":"summary"}\n');
  assert.deepEqual(events.map((event) => event.event), ["trial", "trial", "summary"]);
  assert.equal(events[0].trial, 1);
});

test("BLE parser can flush a final line without newline", () => {
  const events = [];
  const parser = new LineJsonParser((event) => events.push(event));
  parser.pushText('{"event":"status","state":"READY"}');
  parser.flush();
  assert.equal(events[0].state, "READY");
});

test("BLE parser reports malformed JSON without dropping later valid lines", () => {
  const events = [];
  const invalid = [];
  const parser = new LineJsonParser((event) => events.push(event), (line) => invalid.push(line));
  parser.pushText('not-json\n{"event":"trial","trial":3}\n');
  assert.equal(invalid.length, 1);
  assert.equal(events[0].trial, 3);
});
