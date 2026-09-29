// Двухзвенная IK для перетаскивания кистей/стоп. Длины костей сохраняются.
import { Vector3, Quaternion } from 'three';
const point = (bone) => bone.getWorldPosition(new Vector3());
function aim(bone, end, target) {
  const origin = point(bone);
  const from = point(end).sub(origin), to = target.clone().sub(origin);
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  const rotation = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const desired = bone.getWorldQuaternion(new Quaternion()).premultiply(rotation);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new Quaternion()).invert().multiply(desired));
  bone.updateWorldMatrix(true, true);
}
export function solveTwoBone(root, middle, end, target) {
  root.updateWorldMatrix(true, true);
  const origin = point(root), joint = point(middle), tip = point(end);
  const a = origin.distanceTo(joint), b = joint.distanceTo(tip);
  if (a < 1e-8 || b < 1e-8) return;
  const direction = target.clone().sub(origin);
  if (direction.lengthSq() < 1e-12) direction.copy(tip).sub(origin);
  if (direction.lengthSq() < 1e-12) direction.set(0, 1, 0);
  const distance = Math.max(Math.abs(a - b) + 1e-6, Math.min(a + b - 1e-6, direction.length()));
  direction.normalize();
  // Сохраняем текущую сторону сгиба; у прямой конечности выбираем устойчивый полюс.
  const bend = joint.clone().sub(origin);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-10) {
    bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(direction, -direction.x);
  }
  bend.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const desiredJoint = origin.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  const desiredTip = origin.clone().addScaledVector(direction, distance);
  const tipRotation = end.getWorldQuaternion(new Quaternion());
  aim(root, middle, desiredJoint);
  aim(middle, end, desiredTip);
  end.quaternion.copy(end.parent.getWorldQuaternion(new Quaternion()).invert().multiply(tipRotation));
  end.updateWorldMatrix(true, true);
}
export function moveJoint(model, name, target) {
  const bones = model.userData.bones, selected = bones.get(name);
  if (!selected) return;
  const side = name.endsWith('L') ? 'L' : 'R';
  if (/^DEF-hand[LR]$/.test(name)) {
    solveTwoBone(bones.get('DEF-upper_arm' + side), bones.get('DEF-forearm' + side), selected, target);
  } else if (/^DEF-foot[LR]$/.test(name)) {
    solveTwoBone(bones.get('DEF-thigh' + side), bones.get('DEF-shin' + side), selected, target);
  } else if (selected.parent?.isBone && name !== 'DEF-hips') {
    aim(selected.parent, selected, target);
  } else {
    selected.position.copy(selected.parent.worldToLocal(target.clone()));
  }
  model.updateMatrixWorld(true);
}
