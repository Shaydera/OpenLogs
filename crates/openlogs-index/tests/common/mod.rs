#![allow(dead_code)]

use openlogs_parser::Timestamp;

pub struct Unit {
    pub guid: &'static str,
    pub name: &'static str,
    pub flags: &'static str,
}

pub const RAVEL: Unit = Unit {
    guid: "Player-6949-0066C9DA",
    name: "Ravel-Ashwood-Normal-EU",
    flags: "0x511",
};
/// Blackrock Depths (230), instance copy 110435.
pub const GUARDSMAN: Unit = Unit {
    guid: "Creature-0-5250-230-110435-8901-000016ABCD",
    name: "Anvilrage Guardsman",
    flags: "0xa48",
};
pub const WARDEN: Unit = Unit {
    guid: "Creature-0-5250-230-110435-8890-000016ABCE",
    name: "Anvilrage Warden",
    flags: "0xa48",
};
/// Blackrock Depths (230), instance copy 54287.
pub const OTHER_COPY_GUARDSMAN: Unit = Unit {
    guid: "Creature-0-5250-230-54287-8901-000016BBCD",
    name: "Anvilrage Guardsman",
    flags: "0xa48",
};
/// Searing Gorge, outside the dungeon.
pub const BASILISK: Unit = Unit {
    guid: "Creature-0-5250-0-29-5990-000016AAAA",
    name: "Redstone Basilisk",
    flags: "0xa48",
};

pub const BRD: u32 = 230;
pub const BRD_NAME: &str = "Blackrock Depths";

pub fn hit(ts: &str, source: &Unit, target: &Unit, amount: u64) -> String {
    let (s, t) = (source, target);
    format!(
        "{ts}  SPELL_DAMAGE,{},\"{}\",{},0x80000000,{},\"{}\",{},0x80000000,44425,\"Arcane Barrage\",0x40,{},0000000000000000,1000,50000000,0,0,0,0,0,0,1,0,0,0,1590.00,-3.00,2308,1.0000,80,{amount},{amount},-1,64,0,0,0,nil,nil,nil,ST\n",
        s.guid, s.name, s.flags, t.guid, t.name, t.flags, t.guid
    )
}

pub fn died(ts: &str, unit: &Unit) -> String {
    format!(
        "{ts}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,{},\"{}\",{},0x80000000,0\n",
        unit.guid, unit.name, unit.flags
    )
}

pub fn zone(ts: &str, id: u32, name: &str, difficulty: u32) -> String {
    format!("{ts}  ZONE_CHANGE,{id},\"{name}\",{difficulty}\n")
}

pub fn outside(ts: &str) -> String {
    zone(ts, 0, "Searing Gorge", 0)
}

pub fn boss_start(ts: &str, id: u32, name: &str, instance: u32) -> String {
    format!("{ts}  ENCOUNTER_START,{id},\"{name}\",1,5,{instance}\n")
}

pub fn boss_end(ts: &str, id: u32, name: &str, success: bool) -> String {
    format!(
        "{ts}  ENCOUNTER_END,{id},\"{name}\",1,5,{},1000\n",
        u8::from(success)
    )
}

/// A trash pack of one enemy that dies two seconds after the first hit, at `minute`.
pub fn pack(minute: u32, enemy: &Unit) -> String {
    [
        hit(
            &format!("11/17/2026 20:{minute:02}:10.0000"),
            &RAVEL,
            enemy,
            100,
        ),
        died(&format!("11/17/2026 20:{minute:02}:12.0000"), enemy),
    ]
    .concat()
}

pub fn enter_brd(minute: u32) -> String {
    zone(
        &format!("11/17/2026 20:{minute:02}:00.0000"),
        BRD,
        BRD_NAME,
        1,
    )
}

pub fn leave(minute: u32) -> String {
    outside(&format!("11/17/2026 20:{minute:02}:00.0000"))
}

/// Two visits of the same Blackrock Depths copy, each with one trash pack, and a fight
/// outside in between: run 1, its pack 2, the outside pull 3 and the second pack 4.
pub fn dungeon_log() -> String {
    [
        enter_brd(0),
        pack(0, &GUARDSMAN),
        leave(1),
        pack(1, &BASILISK),
        enter_brd(2),
        pack(2, &WARDEN),
        leave(3),
    ]
    .concat()
}

pub fn ts(text: &str) -> Timestamp {
    Timestamp::parse(text).unwrap()
}
