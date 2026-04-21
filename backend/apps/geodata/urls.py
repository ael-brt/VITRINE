from rest_framework.routers import DefaultRouter

from .views import RoadSegmentViewSet

router = DefaultRouter()
router.register("segments", RoadSegmentViewSet, basename="road-segment")

urlpatterns = router.urls
