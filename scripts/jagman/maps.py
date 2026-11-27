"""Field maps for the maintained chapter I appendices. Box coordinates end on the printed line."""


def text(key, label, page, left, bottom, width, height=11, required=False, kind="text"):
    return key, label, kind, required, [(page, left, bottom, width, height)]


def choice(key, label, page, options, required=False):
    return key, label, "singleChoice", required, [(page, 130, y, 9, 9, value, name) for y, value, name in options]


def signature(key, label, page, left, bottom):
    return text(key.replace(" ", "_"), label, page, left, bottom, 195, 19, kind="signature")


RIGHTS = ("d", "Rights notice and election", "0dcd642558abfff51dd62196415fc3dc15351d9b3d4c65a2d58e0fdbbe1cac0a", [
    ("notice", "Notification", [
        text("marine", "Marine name", 1, 94, 193, 232, required=True),
        text("unit", "Assigned unit", 1, 94, 206, 159, required=True),
        text("manual", "Manual for Courts-Martial edition", 1, 151, 266, 173, required=True),
        text("allegation", "Alleged offenses, including articles", 1, 117, 338, 420, 35, True),
        text("evidence", "Evidence summary", 1, 117, 400, 420, 31, True),
        text("maximum", "Applicable maximum punishment", 1, 93, 591, 451, 54, True),
    ]),
    ("counsel", "Counsel consultation", [
        text("military_counsel", "Request military counsel", 3, 132, 268, 9, 9, kind="boolean"),
        text("civilian_counsel", "Request civilian counsel", 3, 132, 304, 9, 9, kind="boolean"),
        text("waived", "Waive consultation", 3, 132, 340, 9, 9, kind="boolean"),
        text("unavailable", "Command determination: consultation was not operationally feasible", 3, 109, 376, 9, 9, kind="boolean"),
        signature("Counsel witness", "Witness to counsel election", 3, 94, 472),
        signature("Counsel Marine", "Marine counsel election", 3, 329, 472),
        text("witness_date", "Witness date", 3, 99, 507, 145, kind="date"),
        text("election_date", "Marine election date", 3, 330, 507, 145, kind="date"),
        text("consulted", "Consultation completed", 3, 132, 616, 9, 9, kind="boolean"),
        text("lawyer", "Lawyer consulted", 3, 291, 616, 213),
        text("consultation_date", "Consultation date", 3, 177, 640, 220, kind="date"),
        signature("Consultation witness", "Witness to consultation", 4, 94, 124),
        signature("Consultation Marine", "Marine consultation acknowledgment", 4, 329, 124),
        text("consult_witness_date", "Consultation witness date", 4, 99, 158, 145, kind="date"),
        text("consult_marine_date", "Consultation acknowledgment date", 4, 330, 158, 145, kind="date"),
    ]),
    ("elections", "Elections", [
        choice("election", "NJP election", 4, [(220,"refuse","Refuse NJP"),(328,"accept","Accept NJP")], True),
        choice("appearance", "Personal appearance", 4, [(460,"request","Request a personal appearance"),(496,"waive","Waive personal appearance")]),
        choice("matters", "Written matters", 4, [(532,"none","No written matters"),(568,"submit","Submit written matters")]),
        text("witness_request", "Request witnesses", 4, 132, 652, 9, 9, kind="boolean"),
        text("witnesses", "Requested witnesses", 4, 201, 714, 275, 39),
        text("open", "Request public proceedings", 5, 132, 208, 9, 9, kind="boolean"),
        text("accused_name", "Printed name of accused", 5, 94, 316, 215),
        text("witness_name", "Printed name of witness", 5, 329, 316, 215),
        signature("Election Marine", "Marine final election", 5, 94, 256),
        signature("Election witness", "Witness to final election", 5, 329, 256),
    ]),
])

FORMS = [RIGHTS]

APPEAL = ("g", "Acknowledgment of appeal rights", "e44de2be4ea00a2d6708ebb5624f135fedc11519d640a4310ad3fc7fab3ceeaa", [
    ("notice", "Appeal rights", [
        text("marine", "Marine name", 1, 117, 158, 265, required=True),
        text("unit", "Assigned unit", 1, 181, 170, 141, required=True),
        text("hearing", "Hearing date", 1, 317, 194, 153, required=True, kind="date"),
        text("authority", "Appeal authority", 1, 122, 244, 413, required=True),
        signature("Appeal Marine", "Marine acknowledgment", 1, 94, 662),
        signature("Appeal witness", "Witness acknowledgment", 1, 329, 662),
    ]),
])
EDUCATION = ("e", "Education assistance reimbursement notice", "3328c4e3acfe6bd1f0b3184743b1e40fe3ca1ddc24425e3867b694d36abc23e9", [
    ("notice", "Acknowledgment", [
        signature("Education Marine", "Marine acknowledgment", 1, 94, 254),
        text("date", "Acknowledgment date", 1, 94, 302, 196, required=True, kind="date"),
        signature("Education witness", "Witness acknowledgment", 1, 94, 350),
    ]),
])

STATEMENT = ("o", "Suspect rights acknowledgment and statement", "622110041498078de3ca023f43df5fee213649447618b7a72c2f9c856b70b73d", [
    ("interview", "Interview", [
        text("marine", "Marine name", 1, 96, 206, 263, required=True),
        text("rank", "Rate or rank", 1, 373, 206, 61),
        text("service", "Service", 1, 445, 206, 91),
        text("unit", "Activity or unit", 1, 96, 254, 263),
        text("birth", "Date of birth", 1, 374, 254, 158, kind="date"),
        text("interviewer", "Interviewer name", 1, 96, 303, 263),
        text("interviewer_rank", "Interviewer rank", 1, 373, 303, 61),
        text("interviewer_service", "Interviewer service", 1, 445, 303, 91),
        text("organization", "Organization", 1, 96, 351, 263),
        text("billet", "Billet", 1, 373, 351, 157),
        text("location", "Interview location", 1, 96, 399, 263),
        text("time", "Interview time", 1, 373, 399, 61),
        text("date", "Interview date", 1, 445, 399, 91, kind="date"),
        text("allegation", "Suspected offenses", 1, 94, 556, 450, 35),
    ]),
    ("rights", "Rights and waiver initials", [
        text(f"initial_{i}", label, page, 504, y, 25, 10)
        for i, (label, page, y) in enumerate([
            ("Notice of suspected offense",1,574), ("Right to remain silent",1,609),
            ("Use of statements",1,670), ("Right to consult counsel",2,142),
            ("Counsel present",2,202), ("Right to stop",2,262),
            ("Understanding of rights",2,346), ("Waiver of silence",2,394),
            ("Desire to make a statement",2,430), ("Waiver of consultation",2,490),
            ("Waiver of counsel presence",2,538), ("Voluntary waiver",2,610),
            ("Right to assert rights later",2,670),
        ], 1)
    ]),
    ("statement", "Statement and signatures", [
        *[field for who, y in [("Suspect",427),("Interviewer",463),("Witness",499)]
          for field in [text(who+"_signature", who+" signature", 3, 96, y, 209, 16, kind="signature"),
                        text(who+"_time", who+" time", 3, 323, y, 74),
                        text(who+"_date", who+" date", 3, 409, y, 60, kind="date")]],
        text("page_count", "Following statement pages", 3, 94, 543, 31),
        signature("Statement suspect", "Statement signature", 3, 320, 612),
        text("statement", "Statement", 3, 94, 715, 452, 66),
        text("continuation", "Continuation", 4, 94, 681, 452, 556),
    ]),
])
FORMS.extend([APPEAL, EDUCATION, STATEMENT])
