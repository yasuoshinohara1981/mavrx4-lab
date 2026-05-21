/**
 * ステージの見せ方（ポスト・トーンマップ出力・背景フォグ）と **{@link StudioBox}** をまとめて import する入口。
 * EffectComposer 利用時は {@link applyStandardPresentationRenderer} と {@link attachPresentationOutputPass}（または {@link setupPostEffectsPipeline}）を使う。
 * シーンは原則 `StudioBox` もここから取る（`StudioBox.js` を直接参照しない）。
 */

import { StudioBox } from '../StudioBox.js';

export { StudioBox };

/** 背景色と距離フォグ（{@link StudioBox.applySceneBackdrop} のエイリアス） */
export function applySceneBackdrop(scene, options) {
    StudioBox.applySceneBackdrop(scene, options);
}

export {
    setupPostEffectsPipeline,
    syncSsaoDepthAndCameraUniforms,
    updateSsaoDistanceAttenuation,
    resizePostEffectsPasses,
    applyStandardPresentationRenderer,
    attachPresentationOutputPass,
    disposePresentationOutputPass
} from './PostEffectsPipeline.js';

export { attachStrobeFlashPass, disposeStrobeFlashPass } from './StrobeFlashPass.js';

export { attachDepthOfField, attachFilmGrainPass } from './DepthOfFieldAndGrain.js';
export { AtmosphericDustField } from './AtmosphericDustField.js';

export {
    STUDIO_ROOM_HALF_W,
    STUDIO_ROOM_HALF_D,
    STUDIO_FLOOR_TOP_Y,
    STUDIO_CEILING_Y,
    ROOM_ENV_PMREM_INTENSITY,
    STUDIO_ROOM_SCENE_FOG_COLOR,
    applyStudioRoomToneAndBackdrop,
    setupStudioRoomEnvironmentMap,
    disposeStudioRoomEnvironmentMap,
    applyStudioRoomFloorWallEnvMaps,
    studioBoxOptionsForStudioRoom,
    studioBoxOptionsForStudioCeilingRow,
    ceilingSpotRigOptionsForStudioRoom,
    ceilingSpotRigOptionsForStudioCeilingRow,
    setupStudioRoomPromoWallFillLight
} from './studioRoomEnvironment.js';
