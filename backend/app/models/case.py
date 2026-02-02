from app.models.timeline import TimeLine


class Case:
    def __init__(self):
        self.timelines: list[TimeLine] = []
