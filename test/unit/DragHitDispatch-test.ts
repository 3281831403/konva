import { assert } from 'chai';

import {
  addStage,
  Konva,
  simulateTouchStart,
  simulateTouchEnd,
  simulateTouchMove,
  countCalls,
} from './test-utils.ts';
import { Container } from '../../src/Container.ts';

// While one finger drags a node, presses, releases and clicks of the other
// fingers are dispatched against the current picture: dragged nodes are hit
// tested at their current position, every other node exactly as without a
// drag. The layer hit canvases stay frozen at the pre-drag graph meanwhile.
describe('Hit dispatch while dragging', function () {
  function setupStage() {
    const stage = addStage();
    const layer = new Konva.Layer();
    stage.add(layer);
    return { stage, layer };
  }

  // 1. a second finger can press, release and tap another shape of the same
  // layer while a shape is dragged; events no longer fall through to stage
  it('a second finger still hits another shape on the dragged layer', function () {
    const { stage, layer } = setupStage();
    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    const other = new Konva.Rect({
      x: 100,
      y: 0,
      width: 40,
      height: 40,
      fill: 'blue',
    });
    layer.add(dragged, other);
    layer.draw();

    const events: string[] = [];
    other.on('touchstart touchend tap', (e) =>
      events.push(`${e.type}:${e.pointerId}`)
    );
    let stageOwnDown = 0;
    stage.on('touchstart', (e) => {
      if (e.target === stage && e.pointerId === 2) stageOwnDown += 1;
    });

    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);
    simulateTouchMove(stage, [{ ...fingerA, x: 60 }], [{ ...fingerA, x: 60 }]);
    assert.equal(dragged.isDragging(), true, 'dragged node is moving');

    const fingerB = { x: 120, y: 20, id: 2 };
    simulateTouchStart(stage, [{ ...fingerA, x: 60 }, fingerB], [fingerB]);
    simulateTouchEnd(stage, [{ ...fingerA, x: 60 }], [fingerB]);

    assert.deepEqual(events, ['touchstart:2', 'touchend:2', 'tap:2']);
    assert.equal(
      stageOwnDown,
      0,
      'the press does not fall through to the stage itself'
    );

    simulateTouchEnd(stage, [], [{ ...fingerA, x: 60 }]);
  });

  // 2. the dragged shape is hit at its current position, not where it started
  it('the dragged shape is hit tested at its current position', function () {
    const { stage, layer } = setupStage();
    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    layer.add(dragged);
    layer.draw();

    const events: string[] = [];
    dragged.on('touchstart', (e) => {
      if (e.pointerId === 2) events.push(`down:${e.pointerId}`);
    });

    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);
    // drag far enough to leave the original area empty
    simulateTouchMove(
      stage,
      [{ ...fingerA, x: 150 }],
      [{ ...fingerA, x: 150 }]
    );
    assert.equal(dragged.x(), 130, 'node followed the finger');

    // a second finger lands on the shape at its NEW position
    const fingerB = { x: 150, y: 20, id: 2 };
    simulateTouchStart(stage, [{ ...fingerA, x: 150 }, fingerB], [fingerB]);
    assert.deepEqual(events, ['down:2']);

    simulateTouchEnd(stage, [{ ...fingerA, x: 150 }], [fingerB]);
    simulateTouchEnd(stage, [], [{ ...fingerA, x: 150 }]);
  });

  // 3. the area the dragged shape used to cover no longer hits it
  it('the old position of the dragged shape is not a hit anymore', function () {
    const { stage, layer } = setupStage();
    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    layer.add(dragged);
    layer.draw();

    const events: string[] = [];
    dragged.on('touchstart', (e) => {
      if (e.pointerId === 2) events.push(`shape:${e.pointerId}`);
    });
    stage.on('touchstart', (e) => {
      if (e.pointerId === 2) events.push(`stage:${e.pointerId}`);
    });

    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);
    simulateTouchMove(
      stage,
      [{ ...fingerA, x: 150 }],
      [{ ...fingerA, x: 150 }]
    );

    // the frozen hit canvas still contains the shape here, but dispatch must
    // describe the current scene, where this area is empty
    assert.equal(
      layer.getIntersection({ x: 20, y: 20 }),
      dragged,
      'getIntersection stays frozen at the pre-drag graph'
    );
    const fingerB = { x: 20, y: 20, id: 2 };
    simulateTouchStart(stage, [{ ...fingerA, x: 150 }, fingerB], [fingerB]);
    assert.deepEqual(events, ['stage:2']);

    simulateTouchEnd(stage, [{ ...fingerA, x: 150 }], [fingerB]);
    simulateTouchEnd(stage, [], [{ ...fingerA, x: 150 }]);
  });

  // 4. a lower shape covered by the dragged shape cannot be hit while covered,
  // and is hit again as soon as the dragged shape moves away. The lower shape
  // lives on another layer and is cached, so layer order and the cached hit
  // graph path are exercised through the offscreen render as well
  it('a lower shape under the dragged shape is not hit until uncovered', function () {
    const stage = addStage();
    const lowerLayer = new Konva.Layer();
    const dragLayer = new Konva.Layer();
    stage.add(lowerLayer);
    stage.add(dragLayer);
    const lower = new Konva.Rect({
      x: 100,
      y: 0,
      width: 40,
      height: 40,
      fill: 'blue',
    });
    lower.cache({ x: -2, y: -2, width: 44, height: 44 });
    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    lowerLayer.add(lower);
    dragLayer.add(dragged);
    stage.draw();

    const hits: string[] = [];
    lower.on('touchstart', () => hits.push('lower'));
    dragged.on('touchstart', (e) => {
      if (e.pointerId !== 1) hits.push(`dragged:${e.pointerId}`);
    });

    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);
    // drag the red rect exactly over the blue one
    simulateTouchMove(
      stage,
      [{ ...fingerA, x: 120 }],
      [{ ...fingerA, x: 120 }]
    );
    assert.deepEqual({ x: dragged.x(), y: dragged.y() }, { x: 100, y: 0 });

    const fingerB = { x: 120, y: 20, id: 2 };
    simulateTouchStart(stage, [{ ...fingerA, x: 120 }, fingerB], [fingerB]);
    assert.deepEqual(hits, ['dragged:2'], 'the covering shape wins the hit');
    simulateTouchEnd(stage, [{ ...fingerA, x: 120 }], [fingerB]);

    // move the red rect away again; the blue one is reachable
    simulateTouchMove(stage, [{ ...fingerA, x: 20 }], [{ ...fingerA, x: 20 }]);
    const fingerC = { x: 120, y: 20, id: 3 };
    simulateTouchStart(stage, [{ ...fingerA, x: 20 }, fingerC], [fingerC]);
    assert.deepEqual(hits, ['dragged:2', 'lower']);
    simulateTouchEnd(stage, [{ ...fingerA, x: 20 }], [fingerC]);

    simulateTouchEnd(stage, [], [{ ...fingerA, x: 20 }]);
  });

  // 5. clipped, non-listening and hidden shapes stay unreachable during a drag
  it('clipped, listening:false and hidden shapes are not hit during a drag', function () {
    const { stage, layer } = setupStage();
    const group = new Konva.Group({
      clipX: 0,
      clipY: 0,
      clipWidth: 50,
      clipHeight: 50,
    });
    const clipped = new Konva.Rect({
      x: 0,
      y: 60,
      width: 40,
      height: 40,
      fill: 'orange',
    });
    const muted = new Konva.Rect({
      x: 100,
      y: 60,
      width: 40,
      height: 40,
      fill: 'grey',
      listening: false,
    });
    const hidden = new Konva.Rect({
      x: 200,
      y: 60,
      width: 40,
      height: 40,
      fill: 'purple',
      visible: false,
    });
    group.add(clipped);
    layer.add(group, muted, hidden);

    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    layer.add(dragged);
    layer.draw();

    const hits: string[] = [];
    clipped.on('touchstart', () => hits.push('clipped'));
    muted.on('touchstart', () => hits.push('muted'));
    hidden.on('touchstart', () => hits.push('hidden'));
    let stageOwnDowns = 0;
    stage.on('touchstart', (e) => {
      if (e.target === stage) stageOwnDowns += 1;
    });

    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);
    simulateTouchMove(stage, [{ ...fingerA, x: 60 }], [{ ...fingerA, x: 60 }]);
    assert.equal(dragged.isDragging(), true);

    const probes = [
      { x: 20, y: 80, id: 2 }, // inside the clipped rect but outside the clip
      { x: 120, y: 80, id: 3 }, // listening: false
      { x: 220, y: 80, id: 4 }, // invisible
    ];
    simulateTouchStart(stage, [{ ...fingerA, x: 60 }, ...probes], probes);
    assert.deepEqual(
      hits,
      [],
      'unreachable shapes are skipped exactly as without a drag'
    );
    assert.equal(
      stageOwnDowns,
      1,
      'the presses without a shape target fall through to the stage'
    );
    simulateTouchEnd(stage, [{ ...fingerA, x: 60 }], probes);

    simulateTouchEnd(stage, [], [{ ...fingerA, x: 60 }]);
  });

  // 6. no hit canvas is ever repainted during a drag, and getIntersection
  // keeps returning the frozen graph
  it('drags never repaint a hit canvas and getIntersection stays frozen', function () {
    assert.equal(
      Konva.hitOnDragEnabled,
      false,
      'the dispatch works without enabling the global hitOnDragEnabled switch'
    );
    const { stage, layer } = setupStage();
    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    const other = new Konva.Rect({
      x: 100,
      y: 0,
      width: 40,
      height: 40,
      fill: 'blue',
    });
    layer.add(dragged, other);
    layer.draw();

    const frozenPixel = layer.hitCanvas.context.getImageData(20, 20, 1, 1).data;
    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);

    // Layer.drawHit() is still entered but returns at once while frozen; spy
    // on the actual graph painter to prove no hit graph is repainted
    const hitGraphPaints = countCalls(Container.prototype, 'drawHit', () => {
      simulateTouchMove(
        stage,
        [{ ...fingerA, x: 60 }],
        [{ ...fingerA, x: 60 }]
      );
      simulateTouchMove(
        stage,
        [{ ...fingerA, x: 90 }],
        [{ ...fingerA, x: 90 }]
      );
      // an explicit layer.draw() must also leave the hit canvas untouched
      layer.draw();
    });
    assert.equal(
      hitGraphPaints,
      0,
      'no hit graph repaint happened during the drag'
    );

    const pixelAfter = layer.hitCanvas.context.getImageData(20, 20, 1, 1).data;
    assert.deepEqual(
      Array.from(pixelAfter),
      Array.from(frozenPixel),
      'the frozen hit pixel is unchanged'
    );
    assert.equal(
      stage.getIntersection({ x: 20, y: 20 }),
      dragged,
      'stage.getIntersection still reports the pre-drag target'
    );
    assert.equal(
      stage.getIntersection({ x: 120, y: 20 }),
      other,
      'shapes that never moved keep their frozen hits'
    );

    simulateTouchEnd(stage, [], [{ ...fingerA, x: 90 }]);
  });

  // 7. after the drag ends the hit graph is rebuilt and everything behaves
  // exactly as before the drag
  it('the hit graph is rebuilt with the final scene after dragend', function () {
    const { stage, layer } = setupStage();
    const dragged = new Konva.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: 'red',
      draggable: true,
    });
    const other = new Konva.Rect({
      x: 100,
      y: 0,
      width: 40,
      height: 40,
      fill: 'blue',
    });
    layer.add(dragged, other);
    layer.draw();

    const fingerA = { x: 20, y: 20, id: 1 };
    simulateTouchStart(stage, [fingerA], [fingerA]);
    simulateTouchMove(stage, [{ ...fingerA, x: 90 }], [{ ...fingerA, x: 90 }]);
    assert.equal(dragged.isDragging(), true);
    simulateTouchEnd(stage, [], [{ ...fingerA, x: 90 }]);
    assert.equal(dragged.isDragging(), false, 'drag is over');

    assert.equal(
      layer.getIntersection({ x: 90, y: 20 }),
      dragged,
      'the moved shape is found at its final position again'
    );
    assert.equal(
      layer.getIntersection({ x: 20, y: 20 }),
      null,
      'the old position is empty again'
    );
    assert.equal(
      layer.getIntersection({ x: 120, y: 20 }),
      other,
      'unmoved shapes keep working'
    );

    // a plain tap after the drag follows the normal path
    const taps: string[] = [];
    other.on('tap', (e) => taps.push(`other:${e.pointerId}`));
    const tap = { x: 120, y: 20, id: 5 };
    simulateTouchStart(stage, [tap], [tap]);
    simulateTouchEnd(stage, [], [tap]);
    assert.deepEqual(taps, ['other:5']);
  });
});
