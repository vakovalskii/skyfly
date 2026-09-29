// Names are stable file identifiers; labels are for the studio only.
const labels = {
  Chest_Open: 'Открыть сундук', ClimbUp_1m: 'Подтянуться на выступ', Consume: 'Выпить / съесть',
  Farm_Harvest: 'Собрать урожай', Farm_PlantSeed: 'Посадить растение', Farm_Watering: 'Полить',
  Hit_Knockback: 'Отброшен ударом', Idle_FoldArms_Loop: 'Стоять, скрестив руки',
  Idle_Lantern_Loop: 'Держать фонарь', Idle_No_Loop: 'Отрицательный жест', Idle_Rail_Call: 'Позвать у перил',
  Idle_Rail_Loop: 'Опереться на перила', Idle_Shield_Break: 'Пробитая защита', Idle_Shield_Loop: 'Стойка со щитом',
  Idle_TalkingPhone_Loop: 'Разговор по телефону', LayToIdle: 'Встать с земли',
  Melee_Hook: 'Хук', Melee_Hook_Rec: 'Вернуться после хука', NinjaJump_Idle_Loop: 'Прыжок · в воздухе',
  NinjaJump_Land: 'Прыжок · приземление', NinjaJump_Start: 'Прыжок · отталкивание', OverhandThrow: 'Бросок сверху',
  Shield_Dash: 'Рывок со щитом', Shield_OneShot: 'Закрыться щитом',
  Slide_Exit: 'Скольжение · выход', Slide_Loop: 'Скольжение', Slide_Start: 'Скольжение · вход',
  Sword_Block: 'Блок мечом', Sword_Dash: 'Рывок с мечом', Sword_Heavy_Combo: 'Тяжёлая комбинация',
  Sword_Regular_A: 'Меч · удар 1', Sword_Regular_A_Rec: 'Меч · возврат 1',
  Sword_Regular_B: 'Меч · удар 2', Sword_Regular_B_Rec: 'Меч · возврат 2',
  Sword_Regular_C: 'Меч · удар 3', Sword_Regular_Combo: 'Меч · комбинация',
  TreeChopping_Loop: 'Рубить дерево', Walk_Carry_Loop: 'Идти с грузом', Yes: 'Кивнуть',
  Zombie_Idle_Loop: 'Зомби · стойка', Zombie_Scratch: 'Зомби · атака', Zombie_Walk_Fwd_Loop: 'Зомби · шаг',
};
export const clipLabel = name => name.startsWith('UAL2:') ? labels[name.slice(5)] || name.slice(5) : name;
export const isLibraryClip = name => name.startsWith('UAL2:');
